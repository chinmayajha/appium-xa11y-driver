import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { MouseButtonName, Rect } from '@crowecawcaw/xa11y';
import { errors } from 'appium/driver';

const run = promisify(execFile);

function jxa(script: string, args: (string | number)[]): Promise<{ stdout: string }> {
  return run('osascript', ['-l', 'JavaScript', '-e', script, '--', ...args.map(String)]);
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
// A post at the HID tap clears only the HID state, and the combined session state needs its own post at the session tap.
const CLEAR_FLAGS = `ObjC.import('CoreGraphics');
function run(argv) {
  const mask = Number(argv[0]);
  const state = () => Number($.CGEventSourceFlagsState(0)) | Number($.CGEventSourceFlagsState(1));
  for (const tap of [$.kCGHIDEventTap, $.kCGSessionEventTap]) {
    const e = $.CGEventCreateKeyboardEvent(null, 63, false);
    $.CGEventSetType(e, 12);
    $.CGEventSetFlags(e, state() & ~mask);
    $.CGEventPost(tap, e);
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

// xa11y 0.15.4 posts a held button at (0, 0) and moves a held button as a plain move (docs/xa11y-gaps.md item 22).
const POST_MOUSE = `ObjC.import('CoreGraphics');
function run(argv) {
  const [type, x, y, button, clicks] = argv.map(Number);
  const e = $.CGEventCreateMouseEvent(null, type, { x, y }, button);
  if (clicks) {
    $.CGEventSetIntegerValueField(e, $.kCGMouseEventClickState, clicks);
  }
  $.CGEventPost($.kCGHIDEventTap, e);
}`;

const MOUSE_EVENTS: Record<MouseButtonName, { button: number; down: number; up: number; dragged: number }> = {
  left: { button: 0, down: 1, up: 2, dragged: 6 },
  right: { button: 1, down: 3, up: 4, dragged: 7 },
  middle: { button: 2, down: 25, up: 26, dragged: 27 },
};

/** Post a mouse button event at the point, which is where the pointer is. */
export async function postButton(at: { x: number; y: number }, button: MouseButtonName, down: boolean): Promise<void> {
  const e = MOUSE_EVENTS[button];
  await jxa(POST_MOUSE, [down ? e.down : e.up, at.x, at.y, e.button, 1]);
}

/** Post a pointer move with a button held, which apps take as a drag. */
export async function postDrag(to: { x: number; y: number }, button: MouseButtonName): Promise<void> {
  const e = MOUSE_EVENTS[button];
  await jxa(POST_MOUSE, [e.dragged, to.x, to.y, e.button, 0]);
}

const FUNCTION_FLAGS = 0x800000 | 0x200000;
const KEY_FLAGS: Record<string, number> = {
  Shift: 0x20000, Ctrl: 0x40000, Alt: 0x80000, Meta: 0x100000,
  ...Object.fromEntries(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Delete', 'Insert',
    ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`)].map((k) => [k, FUNCTION_FLAGS])),
};

// NSScreen frames have a bottom-left origin on the main screen; Desktop coordinates have a top-left origin.
const SCREENS_RECT = `ObjC.import('AppKit');
function run() {
  const screens = $.NSScreen.screens;
  const mainHeight = screens.objectAtIndex(0).frame.size.height;
  let [left, top, right, bottom] = [Infinity, Infinity, -Infinity, -Infinity];
  for (let i = 0; i < screens.count; i++) {
    const f = screens.objectAtIndex(i).frame;
    const y = mainHeight - f.origin.y - f.size.height;
    [left, top] = [Math.min(left, f.origin.x), Math.min(top, y)];
    [right, bottom] = [Math.max(right, f.origin.x + f.size.width), Math.max(bottom, y + f.size.height)];
  }
  return [left, top, right - left, bottom - top].join(' ');
}`;

/** The rect around all screens in Desktop coordinates. */
export async function screensRect(): Promise<Rect> {
  const [x, y, width, height] = (await jxa(SCREENS_RECT, [])).stdout.trim().split(' ').map(Number);
  return { x, y, width, height };
}

const RUNNING_PIDS = `ObjC.import('AppKit');
function run(argv) {
  const [id, bundle] = argv;
  const apps = $.NSRunningApplication.runningApplicationsWithBundleIdentifier(id);
  const pids = [];
  for (let i = 0; i < apps.count; i++) {
    const app = apps.objectAtIndex(i);
    if (!bundle || app.bundleURL.path.js === bundle) {
      pids.push(app.processIdentifier);
    }
  }
  return pids.join(' ');
}`;

/** The pids of the running instances of a bundle id, of every copy or only of the copy at `bundle`. */
export async function runningPids(bundleId: string, bundle?: string): Promise<Set<number>> {
  const { stdout } = await jxa(RUNNING_PIDS, bundle ? [bundleId, bundle] : [bundleId]);
  return new Set(stdout.trim().split(' ').map(Number).filter(Boolean));
}

/** Post a W3C wheel delta in pixels: positive dx goes right, positive dy goes down. */
export async function postPixelScroll(at: { x: number; y: number }, dx: number, dy: number): Promise<void> {
  await jxa(POST_PIXEL_SCROLL, [at.x, at.y, Math.round(dx), Math.round(dy)]);
}

/** Clear the flags that the released keys leave in the session state, so the next synthetic key does not carry them. */
export async function clearFlags(keys: string[]): Promise<void> {
  const mask = keys.reduce((m, k) => m | (KEY_FLAGS[k] ?? 0), 0);
  if (mask && (await jxa(CLEAR_FLAGS, [mask])).stdout.trim() === 'held') {
    throw new errors.UnknownError(`${keys.join(', ')} still held 1 s after the release, so the next key would carry them`);
  }
}
