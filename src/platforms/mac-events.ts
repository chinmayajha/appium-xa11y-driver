import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Rect } from '@crowecawcaw/xa11y';
import { HostError } from '../errors';

const run = promisify(execFile);

function jxa(script: string, args: (string | number)[]): Promise<{ stdout: string }> {
  return run('osascript', ['-l', 'JavaScript', '-e', script, '--', ...args.map(String)]);
}

// Wheel-inverting tools (Unnatural Scroll Wheels, Mos, Scroll Reverser) flip line events and
// leave continuous trackpad events alone, so a continuous pixel event scrolls the same way on every Mac.
// An event from no source copies the session's modifiers, which can still hold a key that xa11y just released.
const POST_PIXEL_SCROLL = `ObjC.import('CoreGraphics');
function run(argv) {
  const [x, y, dx, dy, flags] = argv.map(Number);
  const e = $.CGEventCreateScrollWheelEvent2(null, $.kCGScrollEventUnitPixel, 2, -dy, -dx, 0);
  $.CGEventSetIntegerValueField(e, $.kCGScrollWheelEventIsContinuous, 1);
  $.CGEventSetFlags(e, flags);
  $.CGEventSetLocation(e, { x, y });
  $.CGEventPost($.kCGHIDEventTap, e);
}`;

// NSScreen frames have a bottom-left origin on the main screen; Desktop coordinates have a top-left origin.
const SCREEN_RECTS = `ObjC.import('AppKit');
function run() {
  const screens = $.NSScreen.screens;
  const mainHeight = screens.objectAtIndex(0).frame.size.height;
  const rects = [];
  for (let i = 0; i < screens.count; i++) {
    const f = screens.objectAtIndex(i).frame;
    rects.push([f.origin.x, mainHeight - f.origin.y - f.size.height, f.size.width, f.size.height].join(' '));
  }
  return rects.join('\\n');
}`;

/** The rect of each screen in Desktop coordinates. */
export async function screenRects(): Promise<Rect[]> {
  const { stdout } = await jxa(SCREEN_RECTS, []).catch((e: { stderr?: string; code?: string }) => {
    throw new HostError(`The screens could not be read (${e.stderr?.trim().split('\n')[0] || e.code})`);
  });
  return stdout.trim().split('\n').map((line) => {
    const [x, y, width, height] = line.split(' ').map(Number);
    return { x, y, width, height };
  });
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

const MODIFIER_FLAGS: Record<string, number> = { Shift: 0x20000, Ctrl: 0x40000, Alt: 0x80000, Meta: 0x100000 };

/** Post a W3C wheel delta in pixels with the held modifier keys: positive dx goes right, positive dy goes down. */
export async function postPixelScroll(at: { x: number; y: number }, dx: number, dy: number, held: string[]): Promise<void> {
  const flags = held.reduce((f, k) => f | (MODIFIER_FLAGS[k] ?? 0), 0);
  await jxa(POST_PIXEL_SCROLL, [at.x, at.y, Math.round(dx), Math.round(dy), flags]);
}

const MANUAL_ACCESSIBILITY = `ObjC.import('ApplicationServices');
function run(argv) {
  const app = $.AXUIElementCreateApplication(Number(argv[0]));
  return String($.AXUIElementSetAttributeValue(app, $('AXManualAccessibility'), $.kCFBooleanTrue));
}`;

/** Asks an Electron app to build its web accessibility tree; false when the app does not take the attribute. */
export async function manualAccessibility(pid: number): Promise<boolean> {
  const { stdout } = await jxa(MANUAL_ACCESSIBILITY, [pid]);
  return stdout.trim() === '0';
}
