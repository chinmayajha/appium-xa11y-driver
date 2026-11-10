import { App, type Element } from '@crowecawcaw/xa11y';
import { errors } from 'appium/driver';
import type { Platform } from './platforms';

const WINDOW_WAIT_MS = 5000;

export interface AppRef {
  name?: string;
  pid?: number;
}

/** The Session app: which app the session operates, and the processes the session started. */
export class Target {
  private current?: App;
  private launched: Array<{ pid: number; appId: string }> = [];

  constructor(private platform: Platform, private timeoutMs: number) {}

  get app(): App {
    if (!this.current) {
      throw new errors.NoSuchWindowError('No application is attached to this session');
    }
    return this.current;
  }

  async launch(app: string, args: string[] = []): Promise<App> {
    const pid = await this.platform.launch(app, args, this.timeoutMs);
    this.launched.push({ pid, appId: app });
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
      this.current = await App.byName(ref.name, { timeout: timeoutMs });
    } else {
      this.current = await App.foreground({ timeout: timeoutMs });
    }
    return this.current;
  }

  async activate(): Promise<void> {
    await this.platform.activate(this.app);
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
    const running = await this.platform.runningPid(appId);
    const pids = new Set(this.launched.filter((l) => l.appId === appId).map((l) => l.pid));
    if (running !== undefined) {
      pids.add(running);
    }
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
    const windows = await this.app.windows();
    const win = name ? windows.find((w) => w.name === name) : windows.find((w) => w.active) ?? windows[0];
    if (!win) {
      throw new errors.NoSuchWindowError(name ? `No window named '${name}'` : 'The app has no window');
    }
    return win;
  }

  async focusWindow(name?: string): Promise<void> {
    await this.platform.activate(this.app, name ? await this.window(name) : undefined);
  }

  async closeWindow(name?: string): Promise<void> {
    await (await this.window(name)).close();
  }

  /** Moves the main window when x and y are set, and resizes it when width and height are set. */
  async moveWindow(rect: { x: number | null; y: number | null; width: number | null; height: number | null }): Promise<void> {
    const win = await this.window();
    if (rect.x != null && rect.y != null) {
      await win.moveTo(rect.x, rect.y);
    }
    if (rect.width != null && rect.height != null) {
      await win.resizeTo(rect.width, rect.height);
    }
  }

  async windows(): Promise<Array<Pick<Element, 'name' | 'role' | 'active' | 'bounds'>>> {
    return (await this.app.windows()).map((w) => ({ name: w.name, role: w.role, active: w.active, bounds: w.bounds }));
  }

  async list(): Promise<Array<{ pid: number | null; name: string; foreground: boolean }>> {
    return (await App.list()).map((a) => ({ pid: a.pid, name: a.name, foreground: a.isForeground }));
  }

  terminateLaunched(): boolean {
    const had = this.launched.length > 0;
    for (const { pid } of this.launched) {
      try {
        this.platform.terminate(pid);
      } catch {
        continue;
      }
    }
    this.launched = [];
    return had;
  }
}
