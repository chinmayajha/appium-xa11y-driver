import { execFile } from 'node:child_process';
import { existsSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { App } from '@crowecawcaw/xa11y';
import { errors } from 'appium/driver';
import { activateWindow, keyUps, quit, rawString } from './common';
import { clearFlags, postPixelScroll, runningPids } from './mac-events';
import { NO_FRAME, type Platform } from './platform';

const run = promisify(execFile);
const APP_DIRS = ['/Applications', '/System/Applications', '/System/Applications/Utilities', `${process.env.HOME}/Applications`];

async function out(cmd: string, args: string[]): Promise<string> {
  return (await run(cmd, args)).stdout.trim();
}

async function bundleIdOf(bundle: string): Promise<string> {
  return out('plutil', ['-extract', 'CFBundleIdentifier', 'raw', `${bundle}/Contents/Info.plist`]).catch(() => '');
}

async function scanAppDirs(bundleId: string): Promise<string | undefined> {
  for (const dir of APP_DIRS.filter((d) => existsSync(d))) {
    for (const entry of readdirSync(dir).filter((e) => e.endsWith('.app'))) {
      if (await bundleIdOf(path.join(dir, entry)) === bundleId) {
        return path.join(dir, entry);
      }
    }
  }
  return undefined;
}

const isBundlePath = (app: string) => app.endsWith('.app') && existsSync(app);

async function bundlePath(app: string): Promise<string> {
  if (isBundlePath(app)) {
    return realpathSync(app);
  }
  const query = `kMDItemCFBundleIdentifier == "${app.replace(/"/g, '')}"`;
  const indexed = (await out('mdfind', [query]).catch(() => '')).split('\n').find(Boolean);
  const found = indexed ?? await scanAppDirs(app);
  if (!found) {
    throw new errors.InvalidArgumentError(`No app bundle found for '${app}'. Pass an .app path or a bundle id.`);
  }
  return found;
}

async function requiredBundleId(bundle: string): Promise<string> {
  const id = await bundleIdOf(bundle);
  if (!id) {
    throw new errors.InvalidArgumentError(`'${bundle}' has no CFBundleIdentifier`);
  }
  return id;
}

async function newestPid(bundleId: string, bundle: string, before: Set<number>, timeoutMs: number): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pids = [...await runningPids(bundleId, bundle)].filter((p) => !before.has(p));
    if (pids.length) {
      return Math.max(...pids);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new errors.SessionNotCreatedError(`'${bundle}' did not start within ${timeoutMs} ms`);
}

async function frontmost(): Promise<App | undefined> {
  return App.foreground({ timeout: 0 }).catch(() => undefined);
}

export const mac: Platform = {
  os: 'macos',
  primaryModifier: 'Meta',
  permissionHint: 'Grant Accessibility and Screen & System Audio Recording to the process that runs Appium: the Node.js of the service '
    + '(hosts/mac/setup.sh prints its path), or the terminal app when you run host.sh run in a terminal.',
  async launch(app, args, timeoutMs) {
    const bundle = await bundlePath(app);
    const id = await requiredBundleId(bundle);
    const before = await runningPids(id, bundle);
    await run('open', ['-n', '-a', bundle, ...(args.length ? ['--args', ...args] : [])]);
    return newestPid(id, bundle, before, timeoutMs);
  },
  async isFrontmost(app) {
    return (await frontmost())?.pid === app.pid;
  },
  async frontmostName() {
    return (await frontmost())?.name;
  },
  async activate(app, window) {
    // AXRaise can fail after AXFrontmost already brought the app to the front (Calculator on macOS 26).
    await activateWindow(app, window).catch(async (e) => {
      if ((await frontmost())?.pid !== app.pid) {
        throw e;
      }
    });
  },
  async wheel(input, at, dx, dy) {
    await input.moveTo([at.x, at.y]);
    await postPixelScroll(at, dx, dy);
  },
  async pressKey(input, key) {
    await input.press(key);
    await clearFlags([key]);
  },
  async releaseKeys(input, keys) {
    await keyUps(input, keys);
    await clearFlags(keys);
  },
  windowShadow: async () => NO_FRAME,
  elementRect: async (el) => el.bounds,
  stableId: (el) => el.stableId ?? '',
  identity: (el) => el.stableId ?? '',
  platformRole: (el) => rawString(el, 'ax_role'),
  scrollTypes: new Set(['AXScrollArea']),
  settleAfterReleaseMs: 0,
  terminate: quit,
  async runningPid(appId) {
    const bundle = isBundlePath(appId) ? realpathSync(appId) : undefined;
    const id = bundle ? await bundleIdOf(bundle) : appId;
    const pids = id ? [...await runningPids(id, bundle)] : [];
    return pids.length ? Math.max(...pids) : undefined;
  },
};
