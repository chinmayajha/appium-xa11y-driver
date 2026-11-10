import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { DOMParser, type Element as XmlElement } from '@xmldom/xmldom';
import { ELEMENT, Session, eventually, pngSize, rejectsWith } from './client';
import { fixturesFor } from './fixtures';

const URL = process.env.CONFORMANCE_URL ?? 'http://127.0.0.1:4723';
const fx = fixturesFor(process.env.CONFORMANCE_OS ?? 'mac');
const CONTRACT = ['type', 'name', 'value', 'label', 'id', 'enabled', 'visible', 'focused', 'selected', 'checked',
  'clickable', 'checkable', 'editable', 'scrollable'];
const BOUNDS = ['x', 'y', 'width', 'height'];

async function open(app: string, extra: Record<string, unknown> = {}): Promise<Session> {
  const started = Date.now();
  const s = await Session.create(URL, { platformName: fx.platformName, 'appium:automationName': 'Xa11y', 'appium:app': app, ...extra });
  console.log(`# session for ${app} in ${Date.now() - started} ms`);
  await s.call('POST', '/timeouts', { implicit: 5000 });
  return s;
}

const keys = (...values: string[]) => values.flatMap((value) => [{ type: 'keyDown', value }, { type: 'keyUp', value }]);
const keyboard = (actions: unknown[]) => [{ type: 'key', id: 'keyboard', actions }];

function center(r: { x: number; y: number; width: number; height: number }) {
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
}

async function pointerClick(s: Session, at: { x: number; y: number }): Promise<void> {
  await s.actions([{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: [
    { type: 'pointerMove', duration: 0, x: at.x, y: at.y, origin: 'viewport' },
    { type: 'pointerDown', button: 0 },
    { type: 'pointerUp', button: 0 },
  ] }]);
}

describe('editor', () => {
  let s: Session;
  let field: string;
  const text = () => s.text(field);

  before(async () => {
    s = await open(fx.editor.app);
    field = await s.find('xpath', fx.editor.field);
    await s.clear(field);
  });

  after(async () => {
    await s.clear(field).catch(() => undefined);
    await s.delete();
  });

  test('page source follows the contract', async () => {
    const doc = new DOMParser().parseFromString(await s.source(), 'text/xml');
    const all = Array.from(doc.getElementsByTagName('*')) as XmlElement[];
    assert.ok(all.length > 3);
    for (const el of all) {
      for (const name of CONTRACT) {
        assert.ok(el.hasAttribute(name), `<${el.tagName}> has no ${name}`);
      }
      const hasBounds = BOUNDS.map((b) => el.hasAttribute(b));
      assert.ok(hasBounds.every(Boolean) || !hasBounds.some(Boolean), `<${el.tagName}> has part of its bounds`);
      if (!hasBounds[0]) {
        assert.equal(el.getAttribute('visible'), 'false', `<${el.tagName}> has no bounds but is visible`);
      }
    }
    assert.ok(all.some((el) => el.tagName === fx.editor.field.replace(/^\/\//, '')));
  });

  test('sets and reads text', async () => {
    await s.type(field, 'hello xa11y');
    await eventually(text, (v) => v === 'hello xa11y');
  });

  test('types special keys', async () => {
    await s.clear(field);
    await s.type(field, 'abcd');
    await eventually(text, (v) => v === 'ac\nd');
  });

  test('a primary+a chord selects all', async () => {
    await s.clear(field);
    await s.type(field, 'replace me');
    await eventually(text, (v) => v === 'replace me');
    await s.execute('xa11y: chord', { keys: 'primary+a' });
    await s.actions(keyboard(keys('u')));
    await eventually(text, (v) => v === 'u');
    await s.actions(keyboard([{ type: 'keyDown', value: fx.primary }, ...keys('a'), { type: 'keyUp', value: fx.primary }, ...keys('u', 'b', 'i')]));
    await eventually(text, (v) => v === 'ubi');
    await s.execute('xa11y: chord', { keys: 'Home' });
    await s.execute('xa11y: typeText', { text: 'k' });
    await eventually(text, (v) => v === 'kubi');
  });

  test('wheel deltas scroll in their direction', async () => {
    await s.clear(field);
    await s.type(field, Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n'));
    await eventually(text, (v) => v.endsWith('line 199'), 20000);
    const wheel = (deltaY: number) => s.actions([{ type: 'wheel', id: 'wheel', actions: [
      { type: 'scroll', x: 0, y: 0, deltaX: 0, deltaY, origin: { [ELEMENT]: field } },
    ] }]);
    const [bar] = await s.findAll('xpath', '//scroll_bar[@height > @width]');
    const view = bar ? () => s.attribute(bar, 'value') : async () => (await s.screenshot(field)).toString('base64');
    const settled = async (check: (v: unknown) => boolean) => {
      let last = await view();
      let since = Date.now();
      return eventually(async () => {
        const v = await view();
        if (v !== last) {
          [last, since] = [v, Date.now()];
        }
        return Date.now() - since >= 300 && check(v) ? v : undefined;
      }, (v) => v !== undefined, 8000);
    };
    await wheel(-8000);
    const top = await settled(() => true);
    await wheel(600);
    const down = await settled((v) => v !== top);
    await wheel(-600);
    const up = await settled((v) => v !== down);
    if (bar) {
      assert.ok(Number(top) < Number(down) && Number(up) < Number(down), `scroll bar went ${top} → ${down} → ${up}`);
    }
  });

  test('the Frontmost guard refuses raw input while another app is in front', async () => {
    await s.clear(field);
    const editor = await s.execute<{ pid: number }>('xa11y: activeAppInfo');
    await s.execute('xa11y: launch', { app: fx.calculator.app });
    await s.execute('xa11y: switchApp', { pid: editor.pid });
    field = await s.find('xpath', fx.editor.field);
    await rejectsWith(s.actions(keyboard(keys('z'))), 'invalid element state');
    await rejectsWith(s.execute('xa11y: chord', { keys: 'primary+a' }), 'invalid element state');
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(await text(), '');
    await s.execute('xa11y: focusWindow');
    await eventually(async () => s.actions(keyboard(keys('o', 'k'))).then(() => true, () => false), Boolean);
    await eventually(text, (v) => v === 'ok');
  });
});

describe('calculator', () => {
  let s: Session;
  const button = (k: keyof typeof fx.calculator.buttons) => s.find('xpath', fx.calculator.buttons[k]);
  const shows = (n: string) => eventually(() => s.source(), (src) => src.includes(`"${n}"`));

  before(async () => {
    s = await open(fx.calculator.app);
  });

  after(async () => {
    await s.delete().catch(() => undefined);
  });

  test('finds by every strategy', async () => {
    const seven = await button('7');
    const role = await s.call<string>('GET', `/element/${seven}/name`);
    assert.equal(role, 'button');
    assert.ok((await s.findAll('class name', 'button')).length >= 10);
    const name = (await s.attribute(seven, 'name'))!;
    assert.ok(await s.find('name', name));
    assert.ok(await s.find('accessibility id', fx.calculator.stableId?.id ?? name));
    assert.deepEqual(await s.rect(await s.find('-xa11y selector', `button[name="${name}"]`)), await s.rect(seven));
    assert.equal(await s.attribute(seven, 'no-such-attribute'), null);
    if (fx.calculator.stableId) {
      assert.equal(await s.attribute(await s.find('id', fx.calculator.stableId.id), 'name'), fx.calculator.stableId.name);
    }
    await rejectsWith(s.find('xpath', "//button[@name='no such button']"), 'no such element');
  });

  test('accessibility clicks press buttons', async () => {
    for (const k of ['C', '7', '+', '5', '='] as const) {
      await s.click(await button(k));
    }
    await shows('12');
  });

  test('pointer clicks land on the element rect in Desktop coordinates', async () => {
    const plus = center(await s.rect(await button('+')));
    const five = await button('5');
    const from = center(await s.rect(five));
    const to = center(await s.rect(await button('=')));
    const click = [{ type: 'pointerDown', button: 0 }, { type: 'pointerUp', button: 0 }];
    await s.actions([{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: [
      { type: 'pointerMove', duration: 0, ...plus, origin: 'viewport' }, ...click,
      { type: 'pointerMove', duration: 0, x: 0, y: 0, origin: { [ELEMENT]: five } }, ...click,
      { type: 'pointerMove', duration: 0, x: to.x - from.x, y: to.y - from.y, origin: 'pointer' }, ...click,
    ] }]);
    await shows('17');
    await rejectsWith(pointerClick(s, { x: -100000, y: -100000 }), 'move target out of bounds');
    await rejectsWith(s.actions([{ type: 'pointer', id: 'mouse', actions: [{ type: 'pointerMove', x: 0, y: 0, origin: 'sideways' }] }]), 'invalid argument');
  });

  test('moving the window moves its elements by the same amount', async () => {
    const before = await s.rect(await button('7'));
    const win = await s.call<{ x: number; y: number; width: number; height: number }>('POST', '/window/rect', { x: null, y: null, width: null, height: null });
    const moved = await s.call<{ x: number; y: number }>('POST', '/window/rect', { ...win, x: win.x + 40, y: win.y + 30 });
    const dx = moved.x - win.x;
    const dy = moved.y - win.y;
    assert.ok(dx !== 0 || dy !== 0, `the window did not move from ${JSON.stringify(win)}`);
    await eventually(async () => s.rect(await button('7')), (r) => r.x === before.x + dx && r.y === before.y + dy);
  });

  test('screenshots use Desktop coordinates', async () => {
    const desktop = await s.call<{ width: number; height: number }>('GET', '/window/rect');
    assert.deepEqual(pngSize(await s.screenshot()), { width: desktop.width, height: desktop.height });
    const seven = await button('7');
    const r = await s.rect(seven);
    const shot = pngSize(await s.screenshot(seven));
    assert.ok(Math.abs(shot.width - r.width) <= 1 && Math.abs(shot.height - r.height) <= 1, `${JSON.stringify(shot)} vs ${JSON.stringify(r)}`);
    assert.notDeepEqual(await s.screenshot(seven), await s.screenshot(await button('5')));
  });

  test('a closed window makes its elements stale', async () => {
    const seven = await button('7');
    await s.execute('xa11y: closeWindow');
    await new Promise((r) => setTimeout(r, 500));
    await rejectsWith(s.click(seven), 'stale element reference');
  });
});

describe('session clean-up', () => {
  test('deleting the session ends the app it launched', async () => {
    const s = await open(fx.calculator.app);
    const app = await s.execute<{ pid: number; name: string }>('xa11y: activeAppInfo');
    await s.delete();
    await new Promise((r) => setTimeout(r, 1000));
    await assert.rejects(
      Session.create(URL, { platformName: fx.platformName, 'appium:automationName': 'Xa11y', 'appium:appName': app.name, 'appium:launchTimeout': 2000 }),
      /session not created/,
    );
  });
});

describe('check box', { skip: !fx.checkBox && 'no fixture check box on this OS' }, () => {
  let s: Session;

  before(async () => {
    s = await open(fx.checkBox!.app);
  });

  after(async () => {
    await s.delete();
  });

  test('a click toggles the checked state', async () => {
    const box = await s.find('xpath', fx.checkBox!.xpath);
    const was = await s.selected(box);
    await s.click(box);
    await eventually(() => s.selected(box), (v) => v === !was);
    assert.equal(await s.attribute(box, 'checked'), String(!was));
    await s.click(box);
    await eventually(() => s.selected(box), (v) => v === was);
  });
});
