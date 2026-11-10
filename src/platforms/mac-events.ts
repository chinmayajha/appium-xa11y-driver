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
// A key that carries Fn turns xa11y text (sent on the A key code) into Fn+A, which moves the focus to the Dock.
const SETTLE_FLAGS = `ObjC.import('CoreGraphics');
function run(argv) {
  const [mask, clear] = argv.map(Number);
  const state = () => Number($.CGEventSourceFlagsState(0)) | Number($.CGEventSourceFlagsState(1));
  if (clear) {
    const e = $.CGEventCreateKeyboardEvent(null, 63, false);
    $.CGEventSetType(e, 12);
    $.CGEventSetFlags(e, state() & ~mask);
    $.CGEventPost($.kCGHIDEventTap, e);
  }
  const end = Date.now() + 1000;
  while (state() & mask) {
    if (Date.now() > end) {
      return 'held';
    }
    delay(0.005);
  }
  return 'clear';
}`;

const FLAG_MASKS: Record<string, number> = { Shift: 0x20000, Ctrl: 0x40000, Alt: 0x80000, Meta: 0x100000 };
const FUNCTION_FLAGS = 0x800000 | 0x200000;

/** Post a W3C wheel delta in pixels: positive dx goes right, positive dy goes down. */
export async function postPixelScroll(at: { x: number; y: number }, dx: number, dy: number): Promise<void> {
  await jxa(POST_PIXEL_SCROLL, [at.x, at.y, Math.round(dx), Math.round(dy)]);
}

/** Wait until macOS no longer reports the released modifiers, so the next key does not carry them. */
export async function waitForModifierRelease(keys: string[]): Promise<void> {
  const mask = keys.reduce((m, k) => m | (FLAG_MASKS[k] ?? 0), 0);
  if (mask) {
    await jxa(SETTLE_FLAGS, [mask, 0]);
  }
}

/** Clear the Fn and keypad flags that macOS gives arrow, Home, End, page and F keys. */
export async function clearFunctionFlags(): Promise<void> {
  await jxa(SETTLE_FLAGS, [FUNCTION_FLAGS, 1]);
}
