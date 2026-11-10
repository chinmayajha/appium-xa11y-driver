import { execFile, spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import type { App, Element, InputSim, MouseButtonName } from '@crowecawcaw/xa11y';
import { errors } from 'appium/driver';
import type { Point } from './platform';

const WHEEL_PIXELS_PER_LINE = 20;

export function rawString(el: Element, key: string): string {
  const value = el.raw[key];
  return typeof value === 'string' ? value : '';
}

const gone = (e: unknown) => (e as NodeJS.ErrnoException).code === 'ESRCH';

export function quit(pid: number): void {
  try {
    process.kill(pid, 'SIGTERM');
  } catch (e) {
    if (!gone(e)) {
      throw e;
    }
  }
}

export function quitGroup(pid: number): void {
  try {
    process.kill(-pid, 'SIGTERM');
  } catch (e) {
    if (!gone(e)) {
      throw e;
    }
    quit(pid);
  }
}

export function groupRuns(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (e) {
    return !gone(e);
  }
}

/** When the process started, or undefined when it does not run or the OS cannot tell. */
export async function startedAt(pid: number): Promise<string | undefined> {
  // procps derives lstart from a boot time that moves when the clock is set, so Linux reads the start ticks instead.
  const stat = await readFile(`/proc/${pid}/stat`, 'utf8').catch(() => undefined);
  if (stat !== undefined) {
    return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
  }
  const { stdout } = await promisify(execFile)('ps', ['-o', 'lstart=', '-p', String(pid)]).catch(() => ({ stdout: '' }));
  return stdout.trim() || undefined;
}

export function spawnApp(app: string, args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(app, args, { detached: true, stdio: 'ignore' });
    child.once('error', (e) => reject(new errors.SessionNotCreatedError(`Could not start '${app}': ${e.message}`)));
    child.once('spawn', () => {
      child.unref();
      resolve(child.pid as number);
    });
  });
}

function wheelLines(pixels: number): number {
  return pixels ? Math.sign(pixels) * Math.max(1, Math.round(Math.abs(pixels) / WHEEL_PIXELS_PER_LINE)) : 0;
}

export async function lineWheel(input: InputSim, at: Point, dx: number, dy: number): Promise<void> {
  await input.scroll([at.x, at.y], wheelLines(dx), wheelLines(dy));
}

export async function moveTo(input: InputSim, to: Point): Promise<void> {
  await input.moveTo([to.x, to.y]);
}

export async function mouseDown(input: InputSim, _at: Point, button: MouseButtonName): Promise<void> {
  await input.mouseDown(button);
}

export async function mouseUp(input: InputSim, _at: Point, button: MouseButtonName): Promise<void> {
  await input.mouseUp(button);
}

export async function tap(input: InputSim, key: string): Promise<void> {
  await input.press(key);
}

export async function keyUps(input: InputSim, keys: string[]): Promise<void> {
  for (const k of keys) {
    await input.keyUp(k);
  }
}

export async function mainWindow(app: App): Promise<Element | undefined> {
  const windows = await app.windows();
  return windows.find((w) => w.active) ?? windows[0];
}

export async function activateWindow(app: App, window?: Element): Promise<void> {
  const win = window ?? await mainWindow(app);
  if (!win) {
    throw new errors.NoSuchWindowError(`${app.name} has no window to activate`);
  }
  await win.activate();
}
