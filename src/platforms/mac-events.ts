import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

function jxa(script: string, args: (string | number)[]): Promise<{ stdout: string }> {
  return run('osascript', ['-l', 'JavaScript', '-e', script, ...args.map(String)]);
}

// Wheel-inverting tools (Unnatural Scroll Wheels, Mos, Scroll Reverser) flip line events and
// leave continuous trackpad events alone, so a continuous pixel event scrolls the same way on every Mac.
const POST_PIXEL_SCROLL = `ObjC.import('CoreGraphics');
function run(argv) {
  const [x, y, dx, dy] = argv.map(Number);
  const e = $.CGEventCreateScrollWheelEvent2(null, $.kCGScrollEventUnitPixel, 2, -dy, -dx, 0);
  $.CGEventSetIntegerValueField(e, $.kCGScrollWheelEventIsContinuous, 1);
  $.CGEventSetLocation(e, { x, y });
  $.CGEventPost($.kCGHIDEventTap, e);
}`;

// macOS keeps the flags of the last synthetic key in its session state, and the next synthetic key copies them.
// A key-up made while that state still holds other released keys keeps them, so a modifier can stay down.
// A key that keeps Fn turns xa11y text (sent on the A key code) into Fn+A, which moves the focus to the Dock.
const CLEAR_FLAGS = `ObjC.import('CoreGraphics');
function run(argv) {
  const mask = Number(argv[0]);
  const state = () => Number($.CGEventSourceFlagsState(0)) | Number($.CGEventSourceFlagsState(1));
  const e = $.CGEventCreateKeyboardEvent(null, 63, false);
  $.CGEventSetType(e, 12);
  $.CGEventSetFlags(e, state() & ~mask);
  $.CGEventPost($.kCGHIDEventTap, e);
  const end = Date.now() + 1000;
  while (state() & mask) {
    if (Date.now() > end) {
      return 'held';
    }
    delay(0.005);
  }
  return 'clear';
}`;

const FUNCTION_FLAGS = 0x800000 | 0x200000;
const KEY_FLAGS: Record<string, number> = {
  Shift: 0x20000, Ctrl: 0x40000, Alt: 0x80000, Meta: 0x100000,
  ...Object.fromEntries(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Delete', 'Insert',
    ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`)].map((k) => [k, FUNCTION_FLAGS])),
};

/** Post a W3C wheel delta in pixels: positive dx goes right, positive dy goes down. */
export async function postPixelScroll(at: { x: number; y: number }, dx: number, dy: number): Promise<void> {
  await jxa(POST_PIXEL_SCROLL, [at.x, at.y, Math.round(dx), Math.round(dy)]);
}

/** Clear the flags that the released keys leave in the session state, so the next synthetic key does not carry them. */
export async function clearFlags(keys: string[]): Promise<void> {
  const mask = keys.reduce((m, k) => m | (KEY_FLAGS[k] ?? 0), 0);
  if (mask) {
    await jxa(CLEAR_FLAGS, [mask]);
  }
}

export async function flagsNow(): Promise<string> {
  const { stdout } = await jxa("ObjC.import('CoreGraphics'); function run() { return [0, 1].map((s) => Number($.CGEventSourceFlagsState(s)).toString(16)).join('/'); }", []);
  return stdout.trim();
}
