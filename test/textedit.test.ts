import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { Xa11yDriver } from '../src';

const mac = process.platform === 'darwin';
const driver = new Xa11yDriver({} as never);
const ELEMENT = 'element-6066-11e4-a52e-4f304d4c4746';

async function find(strategy: string, selector: string): Promise<string> {
  return (await driver.findElOrEls(strategy, selector, false))[ELEMENT];
}

function pngSize(b64: string): { width: number; height: number } {
  const buf = Buffer.from(b64, 'base64');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

before(async () => {
  if (!mac) {
    return;
  }
  await driver.createSession({
    alwaysMatch: { platformName: 'Mac', 'appium:automationName': 'Xa11y', 'appium:app': 'com.apple.TextEdit' },
    firstMatch: [{}],
  } as never);
  driver.implicitWaitMs = 5000;
  await driver.xa11yChord('cmd+n');
});

after(async () => {
  if (!mac) {
    return;
  }
  await driver.xa11yChord('cmd+w');
  await driver.click(await find('-xa11y selector', "button[name='Delete']")).catch(() => undefined);
  await driver.deleteSession();
});

test('types into a new document and reads the text back', { skip: !mac }, async () => {
  const area = await find('class name', 'text_area');
  await driver.setValue('hello from appium', area);
  assert.equal(await driver.getText(area), 'hello from appium');
  assert.equal(await driver.getAttribute('editable', area), 'true');
});

test('page source follows the XML contract', { skip: !mac }, async () => {
  const xml = await driver.getPageSource();
  const area = /<text_area [^>]*>/.exec(xml)?.[0] ?? '';
  for (const attr of ['name', 'value', 'label', 'enabled', 'visible', 'focused', 'id', 'clickable', 'checkable', 'editable', 'scrollable']) {
    assert.match(area, new RegExp(` ${attr}="`), `text_area lacks ${attr}`);
  }
  assert.match(area, / x="\d+" y="\d+" width="\d+" height="\d+"/);
  assert.match(xml, /<menu_item [^>]*name="Format"/);
});

test('screenshots share the coordinate scale of the bounds', { skip: !mac }, async () => {
  const area = await find('class name', 'text_area');
  const rect = await driver.getElementRect(area);
  const shot = pngSize(await driver.getElementScreenshot(area));
  assert.ok(Math.abs(shot.width - rect.width) <= 1, `${shot.width} vs ${rect.width}`);
  assert.ok(Math.abs(shot.height - rect.height) <= 1, `${shot.height} vs ${rect.height}`);
});

test('W3C key, pointer and wheel actions drive the document', { skip: !mac }, async () => {
  const area = await find('class name', 'text_area');
  await driver.performActions([
    { type: 'pointer', id: 'mouse', actions: [
      { type: 'pointerMove', x: 0, y: 0, origin: { [ELEMENT]: area } },
      { type: 'pointerDown', button: 0 },
      { type: 'pointerUp', button: 0 },
    ] },
    { type: 'key', id: 'kbd', actions: [
      { type: 'pause', duration: 0 },
      { type: 'keyDown', value: '' }, { type: 'keyDown', value: 'a' }, { type: 'keyUp', value: 'a' }, { type: 'keyUp', value: '' },
      { type: 'keyDown', value: 'x' }, { type: 'keyUp', value: 'x' },
    ] },
  ] as never);
  assert.equal(await driver.getText(area), 'x');
  await driver.performActions([
    { type: 'wheel', id: 'wheel', actions: [{ type: 'scroll', x: 0, y: 0, deltaX: 0, deltaY: 120, origin: { [ELEMENT]: area } }] },
  ] as never);
});

test('a menu opens from the menu bar and closes with Escape', { skip: !mac }, async () => {
  await driver.click(await find('xpath', "//menu_bar/menu_item[@name='Format']"));
  const font = await find('xpath', "//menu_bar/menu_item[@name='Format']//menu_item[@name='Font']");
  assert.equal(await driver.elementDisplayed(font), true);
  await driver.xa11yChord('Escape');
});
