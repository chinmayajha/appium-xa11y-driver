import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Rect } from '@crowecawcaw/xa11y';
import { HostError } from '../errors';

const run = promisify(execFile);

function jxa(script: string, args: (string | number)[]): Promise<{ stdout: string }> {
  return run('osascript', ['-l', 'JavaScript', '-e', script, '--', ...args.map(String)]);
}

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
