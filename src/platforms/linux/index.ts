import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { App, type Element, type Rect } from '@crowecawcaw/xa11y';
import { errors } from 'appium/driver';
import { activateWindow, groupRuns, keyUps, lineWheel, mouseDown, mouseUp, moveTo, quitGroup, rawString, spawnApp, startedAt, tap } from '../common';
import { NO_FRAME, type Frame, type Platform } from '../platform';
import { isGtk4, windowExtents } from './atspi';
import { frameExtents } from './x11';

const NO_POSITION = -2147483648;
// The shadow changes when the window gains or loses focus, so one read serves only one burst of lookups.
const FRAME_TTL_MS = 500;
const frames = new Map<string, { at: number; origin: Promise<Rect | null> }>();

const LAUNCH_POLL_MS = 100;
const NO_WINDOW_GRACE_MS = 5000;
const DETACH_WAIT_MS = 2000;

const pidByName = (name: string) => App.byName(name, { timeout: 0 }).then((app) => app.pid ?? undefined);

const runningPid = (appId: string) => pidByName(appId)
  .catch(() => (appId.includes('/') ? pidByName(path.basename(appId)) : undefined))
  .catch(() => undefined);

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function processGroup(pid: number): Promise<number | undefined> {
  const stat = await readFile(`/proc/${pid}/stat`, 'utf8').catch(() => undefined);
  return stat === undefined ? undefined : Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[2]);
}

/** The apps of a started process and of the processes it started, which keep its process group after it exits. */
async function appsOf(group: number): Promise<Array<{ pid: number; app: App }>> {
  const apps: Array<{ pid: number; app: App }> = [];
  for (const app of await App.list().catch(() => [])) {
    const { pid } = app;
    if (pid !== null && (pid === group || await processGroup(pid) === group)) {
      apps.push({ pid, app });
    }
  }
  return apps;
}

/** The pid of the app that a started process shows; undefined when its process group ends with no window. */
async function shownBy(group: number, app: string, deadline: number): Promise<number | undefined> {
  let accessibleSince: number | undefined;
  for (;;) {
    const apps = await appsOf(group);
    for (const { pid, app: a } of apps) {
      if ((await a.windows().catch(() => [])).length) {
        return pid;
      }
    }
    accessibleSince = apps[0] ? accessibleSince ?? Date.now() : undefined;
    if (accessibleSince !== undefined && Date.now() - accessibleSince >= NO_WINDOW_GRACE_MS) {
      return apps[0].pid;
    }
    if (!groupRuns(group)) {
      return undefined;
    }
    if (Date.now() >= deadline) {
      if (apps[0]) {
        return apps[0].pid;
      }
      quitGroup(group);
      throw new errors.SessionNotCreatedError(`'${app}' runs, but it has no accessible app`);
    }
    await pause(LAUNCH_POLL_MS);
  }
}

async function stopped(pid: number, deadline: number): Promise<boolean> {
  while (await startedAt(pid) !== undefined) {
    if (Date.now() >= deadline) {
      return false;
    }
    await pause(LAUNCH_POLL_MS);
  }
  return true;
}

/** Starts the app; undefined when the started process exits with code 0 and shows no window. */
async function start(app: string, args: string[], deadline: number): Promise<number | undefined> {
  const started = await spawnApp(app, args);
  const shown = await shownBy(started.pid, app, deadline);
  if (shown !== undefined) {
    return shown;
  }
  const code = await started.exitCode;
  if (code !== 0) {
    throw new errors.SessionNotCreatedError(`'${app}' exited with ${code === null ? 'a signal' : `code ${code}`} before it showed a window`);
  }
  return undefined;
}

/** The instance of an app that left the process group of its start. */
async function detached(app: string, deadline: number): Promise<number> {
  const until = Math.min(deadline, Date.now() + DETACH_WAIT_MS);
  for (;;) {
    const pid = await runningPid(app);
    if (pid !== undefined) {
      return pid;
    }
    if (Date.now() >= until) {
      throw new errors.SessionNotCreatedError(`'${app}' exited with code 0 before it showed a window, and no instance of it runs`);
    }
    await pause(LAUNCH_POLL_MS);
  }
}

/** A single-instance app gives the request to its running instance and exits, so that instance is started again. */
async function launch(app: string, args: string[], timeoutMs: number): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  const before = await runningPid(app);
  const first = await start(app, args, deadline);
  if (first !== undefined) {
    return first;
  }
  if (before === undefined) {
    return detached(app, deadline);
  }
  quitGroup(before);
  if (!(await stopped(before, deadline))) {
    throw new errors.SessionNotCreatedError(`'${app}' took its start request to pid ${before}, and that instance did not stop`);
  }
  return (await start(app, args, deadline)) ?? detached(app, deadline);
}

async function topLevelOf(el: Element): Promise<Element> {
  let node = el;
  for (let parent = await el.parent(); parent && parent.role !== 'application'; parent = await parent.parent()) {
    node = parent;
  }
  return node;
}

function pruneFrames(now: number): void {
  for (const [key, { at }] of frames) {
    if (now - at >= FRAME_TTL_MS) {
      frames.delete(key);
    }
  }
}

/** Where the window's visible frame starts: its X11 position plus the shadow that GTK 4 draws inside it. */
function frameOrigin(top: Element): Promise<Rect | null> {
  const b = top.bounds;
  if (!b || top.pid === null) {
    return Promise.resolve(null);
  }
  const key = `${top.pid}|${top.name}|${b.x},${b.y},${b.width},${b.height}`;
  const known = frames.get(key);
  if (known && Date.now() - known.at < FRAME_TTL_MS) {
    return known.origin;
  }
  const origin = frameExtents(top.pid, top.name ?? '')
    .then((f) => (f ? { x: b.x + f.left, y: b.y + f.top, width: b.width - f.left - f.right, height: b.height - f.top - f.bottom } : null))
    .catch(() => null);
  pruneFrames(Date.now());
  frames.set(key, { at: Date.now(), origin });
  return origin;
}

async function gtk4Rect(el: Element, topLevel?: Element): Promise<Rect | null> {
  const top = el.role === 'window' ? el : topLevel ?? await topLevelOf(el);
  const origin = top ? await frameOrigin(top) : null;
  if (!origin || el === top) {
    return origin;
  }
  const inWindow = await windowExtents(el).catch(() => null);
  return inWindow && { ...inWindow, x: origin.x + inWindow.x, y: origin.y + inWindow.y };
}

async function elementRect(el: Element, topLevel?: Element): Promise<Rect | null> {
  const b = el.bounds;
  if (!b || b.x === NO_POSITION || b.y === NO_POSITION) {
    return null;
  }
  const gtk4 = await isGtk4(String(el.raw.bus_name));
  if (gtk4 === undefined) {
    // When the toolkit check fails, only GTK 4's (0, 0) screen position is known to be wrong.
    return b.x === 0 && b.y === 0 ? null : b;
  }
  return gtk4 ? gtk4Rect(el, topLevel) : b;
}

async function windowShadow(win: Element): Promise<Frame> {
  const gtk4 = await isGtk4(String(win.raw.bus_name));
  const frame = gtk4 && win.pid !== null ? await frameExtents(win.pid, win.name ?? '').catch(() => undefined) : undefined;
  return frame ?? NO_FRAME;
}

async function hasActiveWindow(app: App): Promise<boolean> {
  return (await app.windows().catch(() => [])).some((w) => w.active);
}

export const linux: Platform = {
  os: 'linux',
  primaryModifier: 'Ctrl',
  permissionHint: 'Run Appium inside the Desktop session, with its DISPLAY, D-Bus session bus and AT-SPI bus (see hosts/linux/setup.sh).',
  launch,
  isFrontmost: hasActiveWindow,
  async frontmostName() {
    for (const app of await App.list().catch(() => [])) {
      if (await hasActiveWindow(app)) {
        return app.name;
      }
    }
    return undefined;
  },
  activate: activateWindow,
  wheel: lineWheel,
  movePointer: moveTo,
  pressButton: mouseDown,
  releaseButton: mouseUp,
  pressKey: tap,
  releaseKeys: keyUps,
  windowShadow,
  elementRect,
  // xa11y gives the AT-SPI object path here, and it changes every time the app starts.
  stableId: (el) => (el.stableId?.startsWith('/') ? '' : el.stableId ?? ''),
  identity: (el) => `${String(el.raw.bus_name ?? '')}${String(el.raw.object_path ?? '')}`,
  platformRole: (el) => rawString(el, 'atspi_role'),
  scrollTypes: new Set(['scroll pane']),
  // GTK 4 loses a click when the pointer moves on in the same main-loop turn as the previous release (10 ms was enough on Xvfb).
  settleAfterReleaseMs: 50,
  typeTextMovesCaret: true,
  terminate: quitGroup,
  startedAt,
  runningPid,
};
