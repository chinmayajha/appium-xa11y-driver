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
  private launched: number[] = [];

  constructor(private platform: Platform, private timeoutMs: number) {}

  get app(): App {
    if (!this.current) {
      throw new errors.NoSuchWindowError('No application is attached to this session');
    }
    return this.current;
  }

  async launch(app: string, args: string[] = []): Promise<App> {
    const pid = await this.platform.launch(app, args, this.timeoutMs);
    this.launched.push(pid);
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

  async window(name?: string): Promise<Element> {
    const windows = await this.app.windows();
    const win = name ? windows.find((w) => w.name === name) : windows.find((w) => w.active) ?? windows[0];
    if (!win) {
      throw new errors.NoSuchWindowError(name ? `No window named '${name}'` : 'The app has no window');
    }
    return win;
  }

  async list(): Promise<Array<{ pid: number | null; name: string; foreground: boolean }>> {
    return (await App.list()).map((a) => ({ pid: a.pid, name: a.name, foreground: a.isForeground }));
  }

  terminateLaunched(): boolean {
    const had = this.launched.length > 0;
    for (const pid of this.launched) {
      try {
        this.platform.terminate(pid);
      } catch {
        continue;
      }
    }
    this.launched = [];
    return had;
  }

  detach(): void {
    this.current = undefined;
  }
}
