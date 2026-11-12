import { App, type Element } from '@crowecawcaw/xa11y';
import { errors } from 'appium/driver';
import type { Platform } from './platforms';
import { mainWindow } from './platforms/common';

const WINDOW_WAIT_MS = 5000;

const plainName = (name: string) => name.normalize('NFC').replace(/\p{Cf}/gu, '').trim().toLowerCase();

const noWindow =(name?: string) => new errors.NoSuchWindowError(name ? `No window named '${name}'` : 'The app has no window');

interface Launched {
  pid: number;
  appId: string;
  /** Tells the launched process from a later process with the same pid. */
  started?: string;
}

export interface AppRef {
  name?: string;
  pid?: number;
}

/** The Session app: which app the session operates, and the processes the session started. */
export class Target {
  private current?: App;
  private launched: Launched[] = [];

  constructor(private platform: Platform, private timeoutMs: number) {}

  get app(): App {
    if (!this.current) {
      throw new errors.NoSuchWindowError('No application is attached to this session');
    }
    return this.current;
  }

  /** Starts the app, or attaches to the running instance where the platform reopens it; only a started process stops with the session. */
  async launch(app: string, args: string[] = []): Promise<App> {
    const running = await this.platform.runningPid(app);
    const pid = await this.platform.launch(app, args, this.timeoutMs);
    if (pid !== running) {
      this.launched.push({ pid, appId: app, started: await this.platform.startedAt(pid) });
    }
    this.current = await App.byPid(pid, { timeout: this.timeoutMs });
    await this.waitForWindow(Math.min(this.timeoutMs, WINDOW_WAIT_MS));
    await this.platform.activate(this.current).catch(() => undefined);
    return this.current;
  }

  private async waitForWindow(ms: number): Promise<void> {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline && !(await this.app.windows().catch(() => [])).length) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  async attach(ref: AppRef, timeoutMs = this.timeoutMs): Promise<App> {
    if (ref.pid) {
      this.current = await App.byPid(ref.pid, { timeout: timeoutMs });
    } else if (ref.name) {
      this.current = await this.byName(ref.name, timeoutMs);
    } else {
      this.current = await this.frontmost(timeoutMs);
    }
    return this.current;
  }

  /** The app whose name matches without case and invisible format marks (WhatsApp is named "‎WhatsApp" on macOS). */
  private async byName(name: string, timeoutMs: number): Promise<App> {
    const want = plainName(name);
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const app = (await App.list()).find((a) => plainName(a.name) === want);
      if (app) {
        return app;
      }
      if (Date.now() >= deadline) {
        return App.byName(name, { timeout: 0 }).catch((e: Error) => {
          e.message = `No running app is named '${name}'. To start it, use appium:app. ${e.message}`;
          throw e;
        });
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  /** xa11y names the window manager as the foreground app on X11, so the app with the active window wins where one has it. */
  private async frontmost(timeoutMs: number): Promise<App> {
    const front = await App.foreground({ timeout: timeoutMs }).catch(() => undefined);
    if (front && await this.platform.isFrontmost(front).catch(() => true)) {
      return front;
    }
    for (const app of await App.list()) {
      if (await this.platform.isFrontmost(app).catch(() => false)) {
        return app;
      }
    }
    return front ?? App.foreground({ timeout: 0 });
  }

  async activate(): Promise<void> {
    await this.platform.activate(this.app);
  }

  /** Whether the Session app's process still has an accessible app. */
  async alive(): Promise<boolean> {
    const { pid } = this.app;
    return pid !== null && App.byPid(pid, { timeout: 0 }).then(() => true, () => false);
  }

  /** Attaches to a running instance of the app and brings it to the front; launches the app when none runs. */
  async activateOrLaunch(appId: string): Promise<App> {
    const pid = await this.platform.runningPid(appId);
    if (pid === undefined) {
      return this.launch(appId);
    }
    await this.attach({ pid }, 0);
    await this.activate();
    return this.app;
  }

  /** Stops the instances of this app that the session started or that run now; true when there was one. */
  async terminate(appId: string): Promise<boolean> {
    this.launched = await this.live();
    const pids = await this.pidsOf(appId);
    for (const pid of pids) {
      this.platform.terminate(pid);
    }
    this.launched = this.launched.filter((l) => !pids.has(l.pid));
    if (this.current?.pid != null && pids.has(this.current.pid)) {
      this.current = undefined;
    }
    return pids.size > 0;
  }

  async window(name?: string): Promise<Element> {
    const win = name ? (await this.app.windows()).find((w) => w.name === name) : await mainWindow(this.app);
    if (!win) {
      throw noWindow(name);
    }
    return win;
  }

  async focusWindow(name?: string): Promise<void> {
    await this.platform.activate(this.app, name ? await this.window(name) : undefined);
  }

  async closeWindow(name?: string): Promise<void> {
    await (await this.window(name)).close();
  }

  /** Moves the main window when x and y are set, and resizes it when width and height are set and differ from its size. */
  async moveWindow(rect: { x: number | null; y: number | null; width: number | null; height: number | null }): Promise<void> {
    const win = await this.window();
    const s = await this.platform.windowShadow(win);
    if (rect.x != null && rect.y != null) {
      await win.moveTo(rect.x - s.left, rect.y - s.top);
    }
    if (rect.width == null || rect.height == null) {
      return;
    }
    const width = rect.width + s.left + s.right;
    const height = rect.height + s.top + s.bottom;
    if (width !== win.bounds?.width || height !== win.bounds?.height) {
      await win.resizeTo(width, height);
    }
  }

  async windows(): Promise<Array<Pick<Element, 'name' | 'role' | 'active' | 'bounds'>>> {
    return (await this.app.windows()).map((w) => ({ name: w.name, role: w.role, active: w.active, bounds: w.bounds }));
  }

  async list(): Promise<Array<{ pid: number | null; name: string; foreground: boolean }>> {
    return (await App.list()).map((a) => ({ pid: a.pid, name: a.name, foreground: a.isForeground }));
  }

  private async pidsOf(appId: string): Promise<Set<number>> {
    const running = await this.platform.runningPid(appId);
    const pids = this.launched.filter((l) => l.appId === appId).map((l) => l.pid);
    return new Set(running === undefined ? pids : [...pids, running]);
  }

  /** Stops the processes that the session started and that still run; throws the first failure after it tries them all. */
  async terminateLaunched(): Promise<boolean> {
    const live = await this.live();
    this.launched = [];
    const failures: unknown[] = [];
    for (const { pid } of live) {
      try {
        this.platform.terminate(pid);
      } catch (e) {
        failures.push(e);
      }
    }
    if (failures.length) {
      throw failures[0];
    }
    return live.length > 0;
  }

  /** The launched processes that still run; a process with no known start time counts as running. */
  private async live(): Promise<Launched[]> {
    const same = await Promise.all(this.launched.map(async (l) => !l.started || (await this.platform.startedAt(l.pid)) === l.started));
    return this.launched.filter((_, i) => same[i]);
  }
}
