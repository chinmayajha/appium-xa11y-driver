import path from 'node:path';
import { App, type Element, type Rect } from '@crowecawcaw/xa11y';
import { activateWindow, keyUps, lineWheel, quitGroup, rawString, spawnApp, startedAt, tap } from '../common';
import { NO_FRAME, type Frame, type Platform } from '../platform';
import { isGtk4, windowExtents } from './atspi';
import { frameExtents } from './x11';

const NO_POSITION = -2147483648;
// The shadow changes when the window gains or loses focus, so one read serves only one burst of lookups.
const FRAME_TTL_MS = 500;
const frames = new Map<string, { at: number; origin: Promise<Rect | null> }>();

const pidByName = (name: string) => App.byName(name, { timeout: 0 }).then((app) => app.pid ?? undefined);

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
  launch: async (app, args) => spawnApp(app, args),
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
  runningPid: (appId) => pidByName(appId)
    .catch(() => (appId.includes('/') ? pidByName(path.basename(appId)) : undefined))
    .catch(() => undefined),
};
