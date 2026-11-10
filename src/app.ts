import { execFile, spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { App } from '@crowecawcaw/xa11y';
import { errors } from 'appium/driver';

const run = promisify(execFile);

async function out(cmd: string, args: string[]): Promise<string> {
  return (await run(cmd, args)).stdout.trim();
}

const MAC_APP_DIRS = ['/Applications', '/System/Applications', '/System/Applications/Utilities', `${process.env.HOME}/Applications`];

async function bundleIdOf(bundle: string): Promise<string> {
  return out('plutil', ['-extract', 'CFBundleIdentifier', 'raw', `${bundle}/Contents/Info.plist`]).catch(() => '');
}

async function scanAppDirs(bundleId: string): Promise<string | undefined> {
  for (const dir of MAC_APP_DIRS.filter((d) => existsSync(d))) {
    for (const entry of readdirSync(dir).filter((e) => e.endsWith('.app'))) {
      if (await bundleIdOf(path.join(dir, entry)) === bundleId) {
        return path.join(dir, entry);
      }
    }
  }
  return undefined;
}

async function macBundlePath(app: string): Promise<string> {
  if (app.endsWith('.app') && existsSync(app)) {
    return path.resolve(app);
  }
  const query = `kMDItemCFBundleIdentifier == "${app.replace(/"/g, '')}"`;
  const indexed = (await out('mdfind', [query]).catch(() => '')).split('\n').find(Boolean);
  const found = indexed ?? await scanAppDirs(app);
  if (!found) {
    throw new errors.InvalidArgumentError(`No app bundle found for '${app}'. Pass an .app path or a bundle id.`);
  }
  return found;
}

async function pidsOf(executable: string): Promise<Set<number>> {
  const pattern = executable.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const { stdout } = await run('pgrep', ['-f', pattern]).catch(() => ({ stdout: '' }));
  return new Set(stdout.split('\n').map(Number).filter(Boolean));
}

async function newestPid(executable: string, before: Set<number>, timeoutMs: number): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pids = [...await pidsOf(executable)].filter((p) => !before.has(p));
    if (pids.length) {
      return Math.max(...pids);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new errors.SessionNotCreatedError(`'${executable}' did not start within ${timeoutMs} ms`);
}

async function launchMac(app: string, args: string[], timeoutMs: number): Promise<number> {
  const bundle = await macBundlePath(app);
  const exe = await out('plutil', ['-extract', 'CFBundleExecutable', 'raw', `${bundle}/Contents/Info.plist`]);
  const executable = `${bundle}/Contents/MacOS/${exe}`;
  const before = await pidsOf(executable);
  await run('open', ['-n', '-a', bundle, ...(args.length ? ['--args', ...args] : [])]);
  return newestPid(executable, before, timeoutMs);
}

function launchOther(app: string, args: string[]): number {
  const child = spawn(app, args, { detached: true, stdio: 'ignore' });
  child.unref();
  if (!child.pid) {
    throw new errors.SessionNotCreatedError(`Could not start '${app}'`);
  }
  return child.pid;
}

export async function launch(app: string, args: string[], timeoutMs: number): Promise<number> {
  return process.platform === 'darwin' ? launchMac(app, args, timeoutMs) : launchOther(app, args);
}

export async function attach(target: { pid?: number; name?: string }, timeoutMs: number): Promise<App> {
  if (target.pid) {
    return App.byPid(target.pid, { timeout: timeoutMs });
  }
  if (target.name) {
    return App.byName(target.name, { timeout: timeoutMs });
  }
  return App.foreground({ timeout: timeoutMs });
}

export function terminate(pid: number): void {
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    return;
  }
}
