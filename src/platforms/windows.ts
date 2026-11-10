import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { App } from '@crowecawcaw/xa11y';
import { errors } from 'appium/driver';
import { activateWindow, keyUps, lineWheel, quit, rawString, spawnApp, tap } from './common';
import { NO_FRAME, type Platform } from './platform';

/** The app name of the process that a launcher started, by the app id that was launched. */
const launchedAs = new Map<string, string>();

// UIA ControlType ids start at 50000 (UIA_ButtonControlTypeId) and run in this order.
const CONTROL_TYPES = ['Button', 'Calendar', 'CheckBox', 'ComboBox', 'Edit', 'Hyperlink', 'Image', 'ListItem', 'List', 'Menu',
  'MenuBar', 'MenuItem', 'ProgressBar', 'RadioButton', 'ScrollBar', 'Slider', 'Spinner', 'StatusBar', 'Tab', 'TabItem', 'Text',
  'ToolBar', 'ToolTip', 'Tree', 'TreeItem', 'Custom', 'Group', 'Thumb', 'DataGrid', 'DataItem', 'Document', 'SplitButton',
  'Window', 'Pane', 'Header', 'HeaderItem', 'Table', 'TitleBar', 'Separator', 'SemanticZoom', 'AppBar'];

const exeName = (appId: string) => path.win32.basename(appId).replace(/\.exe$/i, '');

interface ProcessInfo {
  parent: number;
  created: string;
}

async function processInfo(pid: number): Promise<ProcessInfo | undefined> {
  const script = `$p = Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}'; if ($p) { "$($p.ParentProcessId) $($p.CreationDate.ToFileTimeUtc())" }`;
  const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]).catch(() => ({ stdout: '' }));
  const [parent, created] = stdout.trim().split(' ');
  return created ? { parent: Number(parent), created } : undefined;
}

async function apps(): Promise<App[]> {
  return App.list().catch(() => []);
}

function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function hasWindow(pid: number): Promise<boolean> {
  const app = await App.byPid(pid, { timeout: 0 }).catch(() => undefined);
  return app !== undefined && (await app.windows().catch(() => [])).length > 0;
}

async function foreground(): Promise<App | undefined> {
  return App.foreground({ timeout: 0 }).catch(() => undefined);
}

/** The new app whose parent is the launcher; any other new app can belong to the user. */
async function childOf(launcher: number, before: Set<number | null>): Promise<App | undefined> {
  for (const app of (await apps()).filter((a) => a.pid !== null && !before.has(a.pid))) {
    if ((await processInfo(app.pid as number))?.parent === launcher) {
      return app;
    }
  }
  return undefined;
}

/** A launcher such as calc.exe starts the app in a child process and exits, so that child wins then. */
async function started(appId: string, pid: number, before: Set<number | null>): Promise<number | undefined> {
  if (await hasWindow(pid)) {
    return pid;
  }
  const child = running(pid) ? undefined : await childOf(pid, before);
  if (child) {
    launchedAs.set(appId, child.name);
  }
  return child?.pid ?? undefined;
}

async function pidNamed(name: string): Promise<number | undefined> {
  const wanted = name.toLowerCase();
  const app = (await apps()).find((a) => a.name.toLowerCase() === wanted);
  return app?.pid ?? undefined;
}

export const windows: Platform = {
  os: 'windows',
  primaryModifier: 'Ctrl',
  permissionHint: 'Run Appium in the same desktop session as the app, and at the same or a higher integrity level.',
  async launch(app, args, timeoutMs) {
    const before = new Set((await App.list()).map((a) => a.pid));
    const pid = await spawnApp(app, args);
    for (const deadline = Date.now() + timeoutMs; Date.now() < deadline;) {
      const found = await started(app, pid, before);
      if (found !== undefined) {
        return found;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new errors.SessionNotCreatedError(`'${app}' showed no window, and started no app of its own, within ${timeoutMs} ms`);
  },
  async isFrontmost(app) {
    return (await foreground())?.pid === app.pid;
  },
  async frontmostName() {
    return (await foreground())?.name;
  },
  activate: activateWindow,
  // xa11y sends a positive dy to Windows as a forward wheel turn, which scrolls up.
  wheel: (input, at, dx, dy) => lineWheel(input, at, dx, -dy),
  pressKey: tap,
  releaseKeys: keyUps,
  windowShadow: async () => NO_FRAME,
  elementRect: async (el) => el.bounds,
  // xa11y gives the window handle where a control has one, and the handle changes every time the app starts.
  stableId: (el) => rawString(el, 'automation_id'),
  identity: (el) => el.stableId ?? '',
  platformRole: (el) => CONTROL_TYPES[Number(el.raw.control_type_id) - 50000] ?? '',
  scrollTypes: new Set(),
  settleAfterReleaseMs: 0,
  // Notepad: typeText('ab') then typeText('c') gives 'cab'.
  typeTextMovesCaret: false,
  terminate: quit,
  startedAt: async (pid) => (await processInfo(pid))?.created,
  async runningPid(appId) {
    const learned = launchedAs.get(appId);
    return (await pidNamed(exeName(appId))) ?? (learned === undefined ? undefined : pidNamed(learned));
  },
};
