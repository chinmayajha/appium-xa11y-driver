import { spawn } from 'node:child_process';
import type { App, Element, InputSim } from '@crowecawcaw/xa11y';
import { errors } from 'appium/driver';
import type { Point } from './platform';

const WHEEL_PIXELS_PER_LINE = 20;

export function spawnApp(app: string, args: string[]): number {
  const child = spawn(app, args, { detached: true, stdio: 'ignore' });
  child.unref();
  if (!child.pid) {
    throw new errors.SessionNotCreatedError(`Could not start '${app}'`);
  }
  return child.pid;
}

function wheelLines(pixels: number): number {
  return pixels ? Math.sign(pixels) * Math.max(1, Math.round(Math.abs(pixels) / WHEEL_PIXELS_PER_LINE)) : 0;
}

export async function lineWheel(input: InputSim, at: Point, dx: number, dy: number): Promise<void> {
  await input.scroll([at.x, at.y], wheelLines(dx), wheelLines(dy));
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

export async function activateWindow(app: App): Promise<void> {
  const win = await mainWindow(app);
  if (!win) {
    throw new errors.NoSuchWindowError(`${app.name} has no window to activate`);
  }
  await win.activate();
}
