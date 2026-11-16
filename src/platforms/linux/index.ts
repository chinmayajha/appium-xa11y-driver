import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { App, type Element } from '@crowecawcaw/xa11y';
import { errors } from 'appium/driver';
import { activateWindow, groupRuns, lineWheel, quitGroup, rawString, spawnApp, startedAt } from '../common';
import { NO_FRAME, type Frame, type Platform } from '../platform';
import { isGtk4 } from './atspi';
import { frameExtents } from './x11';

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
  windowShadow,
  // xa11y gives the AT-SPI object path here, and it changes every time the app starts.
  stableId: (el) => (el.stableId?.startsWith('/') ? '' : el.stableId ?? ''),
  identity: (el) => `${String(el.raw.bus_name ?? '')}${String(el.raw.object_path ?? '')}`,
  platformRole: (el) => rawString(el, 'atspi_role'),
  shownElsewhere: async () => false,
  scrollTypes: new Set(['scroll pane']),
  menuButtonTypes: new Set(),
  // GTK 4 loses a click when the pointer moves on in the same main-loop turn as the previous release (10 ms was enough on Xvfb).
  settleAfterReleaseMs: 50,
  terminate: quitGroup,
  startedAt,
  runningPid,
};
