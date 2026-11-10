#!/usr/bin/env node
import assert from 'node:assert/strict';

const [url = 'http://127.0.0.1:4723', app, field, platformName = { darwin: 'Mac', win32: 'Windows' }[process.platform] ?? 'Linux'] = process.argv.slice(2);
if (!app || !field) {
  console.error('Usage: webdriver-smoke.mjs <appium url> <app> <text field xpath> [platformName]');
  process.exit(2);
}
const ELEMENT = 'element-6066-11e4-a52e-4f304d4c4746';
const PRIMARY = platformName === 'Mac' ? '' : '';
const headers = { 'Content-Type': 'application/json', ...(process.env.SMOKE_USER_AGENT ? { 'User-Agent': process.env.SMOKE_USER_AGENT } : {}) };
let failures = 0;

async function call(method, path, body) {
  const res = await fetch(`${url}${path}`, { method, headers, body: body && JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`${method} ${path}: ${json.value?.error}: ${json.value?.message?.split('\n')[0]}`);
  }
  return json.value;
}

async function step(name, fn) {
  const t = performance.now();
  try {
    const v = await fn();
    console.log(`ok   ${String(Math.round(performance.now() - t)).padStart(5)} ms  ${name}  ${JSON.stringify(v)?.slice(0, 120) ?? ''}`);
    return v;
  } catch (e) {
    failures++;
    console.log(`FAIL ${String(Math.round(performance.now() - t)).padStart(5)} ms  ${name}  ${e.message.slice(0, 300)}`);
    return undefined;
  }
}

async function eventually(read, check, ms = 3000) {
  const end = Date.now() + ms;
  let v = await read();
  while (!check(v) && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 50));
    v = await read();
  }
  assert.ok(check(v), `still ${JSON.stringify(v)}`);
  return v;
}

const pngSize = (b64) => { const b = Buffer.from(b64, 'base64'); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
const keys = (...values) => values.flatMap((v) => [{ type: 'keyDown', value: v }, { type: 'keyUp', value: v }]);

const caps = { platformName, 'appium:automationName': 'Xa11y', 'appium:app': app };
const session = await step('new session', async () => (await call('POST', '/session', { capabilities: { alwaysMatch: caps } })).sessionId);
if (!session) {
  process.exit(1);
}
const s = `/session/${session}`;
try {
  const el = await step('find text field', async () => (await call('POST', `${s}/element`, { using: 'xpath', value: field }))[ELEMENT]);
  const text = () => call('GET', `${s}/element/${el}/text`);
  await step('page source', async () => `${(await call('GET', `${s}/source`)).length} chars`);
  await step('clear and type', async () => {
    await call('POST', `${s}/element/${el}/clear`, {});
    await call('POST', `${s}/element/${el}/value`, { text: 'hello xa11y' });
    return eventually(text, (v) => v === 'hello xa11y');
  });
  await step('W3C click into the field', () => call('POST', `${s}/actions`, { actions: [{ type: 'pointer', id: 'mouse', actions: [
    { type: 'pointerMove', x: 0, y: 0, origin: { [ELEMENT]: el } }, { type: 'pointerDown', button: 0 }, { type: 'pointerUp', button: 0 },
  ] }] }));
  await step('W3C keys: select all, type', async () => {
    await call('POST', `${s}/actions`, { actions: [{ type: 'key', id: 'kbd', actions: [
      { type: 'keyDown', value: PRIMARY }, ...keys('a'), { type: 'keyUp', value: PRIMARY }, ...keys('u', 'b', 'i'),
    ] }] });
    return eventually(text, (v) => v === 'ubi');
  });
  await step('W3C wheel down and up', async () => {
    await call('POST', `${s}/element/${el}/value`, { text: Array.from({ length: 200 }, (_, i) => `\nline ${i}`).join('') });
    await eventually(text, (v) => v.endsWith('line 199'), 10000);
    const wheel = (deltaY) => call('POST', `${s}/actions`, { actions: [{ type: 'wheel', id: 'wheel', actions: [
      { type: 'scroll', x: 0, y: 0, deltaX: 0, deltaY, origin: { [ELEMENT]: el } },
    ] }] });
    const [bar] = await call('POST', `${s}/elements`, { using: 'xpath', value: '//scroll_bar[@height > @width]' });
    const view = bar
      ? () => call('GET', `${s}/element/${bar[ELEMENT]}/attribute/value`)
      : () => call('GET', `${s}/element/${el}/screenshot`);
    const settled = async (phase, check) => {
      let last = await view();
      let since = Date.now();
      const read = async () => {
        const v = await view();
        if (v !== last) {
          [last, since] = [v, Date.now()];
        }
        return Date.now() - since >= 300 && check(v) ? v : phase;
      };
      return eventually(read, (v) => v !== phase, 5000);
    };
    await wheel(-100000);
    const top = await settled('the view did not settle at the top', () => true);
    await wheel(600);
    await settled('the view did not move down', (v) => v !== top);
    await wheel(-600);
    await settled('the view did not come back to the top', (v) => v === top);
    return 'moved down, then back to the top';
  });
  await step('screenshot', async () => pngSize(await call('GET', `${s}/screenshot`)));
  await step('element screenshot', async () => pngSize(await call('GET', `${s}/element/${el}/screenshot`)));
  await step('clear', async () => { await call('POST', `${s}/element/${el}/clear`, {}); return eventually(text, (v) => v === ''); });
} finally {
  await step('delete session', () => call('DELETE', s));
}
console.log(failures ? `${failures} failed` : 'all passed');
process.exit(failures ? 1 : 0);
