import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { App } from '@crowecawcaw/xa11y';
import { errors } from 'appium/driver';
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
});

after(async () => {
  if (!mac) {
    return;
  }
  await driver.xa11yCloseWindow();
  driver.implicitWaitMs = 2000;
  await driver.click(await find('xpath', "//button[@name='Delete']")).catch(() => undefined);
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
  assert.match(xml, /\n<application [^>]*name="TextEdit"/);
});

test('screenshots share the coordinate scale of the bounds', { skip: !mac }, async () => {
  const area = await find('class name', 'text_area');
  const rect = await driver.getElementRect(area);
  const shot = pngSize(await driver.getElementScreenshot(area));
  assert.ok(Math.abs(shot.width - rect.width) <= 1, `${shot.width} vs ${rect.width}`);
  assert.ok(Math.abs(shot.height - rect.height) <= 1, `${shot.height} vs ${rect.height}`);
});

test('W3C key, pointer and wheel actions drive the document', { skip: !mac }, async (t) => {
  const area = await find('class name', 'text_area');
  const front = await App.foreground({ timeout: 0 });
  if (front.name !== 'TextEdit') {
    await assert.rejects(driver.xa11yChord('cmd+a'), errors.InvalidElementStateError);
    t.skip(`${front.name} holds the foreground, so raw input is refused`);
    return;
  }
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

test('a click toggles a format bar check box', { skip: !mac }, async () => {
  const bold = await find('xpath', "//check_box[@name='bold']");
  const was = await driver.elementSelected(bold);
  await driver.click(bold);
  assert.equal(await driver.elementSelected(bold), !was);
  await driver.click(bold);
  assert.equal(await driver.elementSelected(bold), was);
});
