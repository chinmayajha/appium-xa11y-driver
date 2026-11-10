import { BaseDriver, errors } from 'appium/driver';
import { util } from 'appium/support';
import type { DefaultCreateSessionResult, DriverData, ExecuteMethodMap, W3CDriverCaps } from '@appium/types';
import { desiredCapConstraints, type Xa11yConstraints } from './constraints';
import { asWebDriverError } from './errors';
import { Input, type ActionSequence } from './input';
import { currentPlatform, type Platform } from './platforms';
import { Screen } from './screen';
import { Target } from './target';
import { LOCATOR_STRATEGIES, Tree } from './tree';

interface Session {
  platform: Platform;
  target: Target;
  tree: Tree;
  input: Input;
}

const DEFAULT_LAUNCH_TIMEOUT_MS = 20000;

export class Xa11yDriver extends BaseDriver<Xa11yConstraints> {
  static executeMethodMap = {
    'xa11y: chord': { command: 'xa11yChord', params: { required: ['keys'] } },
    'xa11y: typeText': { command: 'xa11yTypeText', params: { required: ['text'] } },
    'xa11y: focusWindow': { command: 'xa11yFocusWindow', params: { optional: ['name'] } },
    'xa11y: closeWindow': { command: 'xa11yCloseWindow', params: { optional: ['name'] } },
    'xa11y: launch': { command: 'xa11yLaunch', params: { required: ['app'], optional: ['arguments'] } },
    'xa11y: switchApp': { command: 'xa11ySwitchApp', params: { optional: ['name', 'pid'] } },
    'xa11y: listApps': { command: 'xa11yListApps' },
    'xa11y: listWindows': { command: 'xa11yListWindows' },
    'xa11y: activeAppInfo': { command: 'xa11yActiveAppInfo' },
  } as const satisfies ExecuteMethodMap<Xa11yDriver>;

  private session?: Session;
  private screen = new Screen();

  constructor(opts = {} as ConstructorParameters<typeof BaseDriver>[0], shouldValidateCaps = true) {
    super(opts, shouldValidateCaps);
    this.desiredCapConstraints = desiredCapConstraints;
    this.locatorStrategies = LOCATOR_STRATEGIES;
  }

  async executeCommand<T = unknown>(cmd: string, ...args: any[]): Promise<T> {
    const started = performance.now();
    try {
      return await super.executeCommand<T>(cmd, ...args);
    } catch (e) {
      throw asWebDriverError(e, this.session?.platform.permissionHint);
    } finally {
      this.log.info(`${cmd} took ${Math.round(performance.now() - started)} ms`);
    }
  }

  async createSession(
    w3cCaps1: W3CDriverCaps<Xa11yConstraints>, w3cCaps2?: W3CDriverCaps<Xa11yConstraints>,
    w3cCaps3?: W3CDriverCaps<Xa11yConstraints>, driverData?: DriverData[],
  ): Promise<DefaultCreateSessionResult<Xa11yConstraints>> {
    const result = await super.createSession(w3cCaps1, w3cCaps2, w3cCaps3, driverData);
    try {
      const platform = currentPlatform();
      const target = new Target(platform, this.opts.launchTimeout ?? DEFAULT_LAUNCH_TIMEOUT_MS);
      const tree = new Tree(target, platform);
      this.session = { platform, target, tree, input: new Input(target, tree, platform, this.screen) };
      if (this.opts.app) {
        await target.launch(this.opts.app, this.opts.appArguments ?? []);
      } else {
        await target.attach({ name: this.opts.appName });
      }
    } catch (e) {
      const hint = this.session?.platform.permissionHint;
      await this.deleteSession();
      const err = asWebDriverError(e, hint);
      throw err instanceof errors.SessionNotCreatedError ? err : new errors.SessionNotCreatedError((err as Error).message);
    }
    return result;
  }

  async deleteSession(sessionId?: string | null): Promise<void> {
    const s = this.session;
    if (s) {
      await s.input.release().catch(() => undefined);
      if (this.opts.terminateOnDelete !== false) {
        s.target.terminateLaunched();
      }
    }
    this.session = undefined;
    await super.deleteSession(sessionId);
  }

  private get s(): Session {
    if (!this.session) {
      throw new errors.NoSuchDriverError('No session is running');
    }
    return this.session;
  }

  async findElOrEls(strategy: string, selector: string, mult: true, context?: string): Promise<any[]>;
  async findElOrEls(strategy: string, selector: string, mult: false, context?: string): Promise<any>;
  async findElOrEls(strategy: string, selector: string, mult: boolean, context?: string): Promise<any> {
    const ids = await this.s.tree.find(strategy, selector, context, this.implicitWaitMs);
    if (mult) {
      return ids.map((id) => util.wrapElement(id));
    }
    if (!ids.length) {
      throw new errors.NoSuchElementError(`No element matches ${strategy} '${selector}'`);
    }
    return util.wrapElement(ids[0]);
  }

  async getPageSource(): Promise<string> {
    return this.s.tree.source();
  }

  async active(): Promise<any> {
    const id = await this.s.tree.focused();
    if (!id) {
      throw new errors.NoSuchElementError('No element has keyboard focus');
    }
    return util.wrapElement(id);
  }

  async click(id: string): Promise<void> {
    await this.s.input.click(id);
  }

  async setValue(text: string | string[], id: string): Promise<void> {
    await this.s.input.type(Array.isArray(text) ? text.join('') : text, id);
  }

  async clear(id: string): Promise<void> {
    await this.s.input.clear(id);
  }

  async getText(id: string): Promise<string> {
    return (await this.s.tree.attribute(id, 'text')) ?? '';
  }

  async getAttribute(name: string, id: string): Promise<string | null> {
    return this.s.tree.attribute(id, name);
  }

  async getProperty(name: string, id: string): Promise<string | null> {
    return this.s.tree.attribute(id, name);
  }

  async getName(id: string): Promise<string> {
    return (await this.s.tree.element(id)).role;
  }

  async getElementRect(id: string) {
    return (await this.s.tree.rect(id)) ?? { x: 0, y: 0, width: 0, height: 0 };
  }

  async elementDisplayed(id: string): Promise<boolean> {
    return (await this.s.tree.attribute(id, 'visible')) === 'true';
  }

  async elementEnabled(id: string): Promise<boolean> {
    return (await this.s.tree.element(id)).enabled;
  }

  async elementSelected(id: string): Promise<boolean> {
    const el = await this.s.tree.element(id);
    return el.selected || el.checked === 'on';
  }

  async getScreenshot(): Promise<string> {
    return (await this.screen.capture()).toString('base64');
  }

  async getElementScreenshot(id: string): Promise<string> {
    return (await this.screen.capture(await this.s.tree.visibleRect(id))).toString('base64');
  }

  async performActions(actions: ActionSequence[]): Promise<void> {
    await this.s.input.perform(actions);
  }

  async releaseActions(): Promise<void> {
    await this.s.input.release();
  }

  async getWindowRect() {
    return this.screen.desktop();
  }

  async setWindowRect(x: number | null, y: number | null, width: number | null, height: number | null) {
    const win = await this.s.target.window();
    if (x != null && y != null) {
      await win.moveTo(x, y);
    }
    if (width != null && height != null) {
      await win.resizeTo(width, height);
    }
    return (await this.s.tree.windowRect()) ?? { x: 0, y: 0, width: 0, height: 0 };
  }

  async execute(script: string, args: unknown[]): Promise<unknown> {
    if (!script.trim().startsWith('xa11y:')) {
      throw new errors.NotImplementedError(`Only 'xa11y:' execute methods are supported, got '${script}'`);
    }
    return this.executeMethod(script.trim().replace(/^xa11y:\s*/, 'xa11y: '), args);
  }

  async xa11yChord(keys: string): Promise<void> {
    await this.s.input.chord(keys);
  }

  async xa11yTypeText(text: string): Promise<void> {
    await this.s.input.type(text);
  }

  async xa11yFocusWindow(name?: string): Promise<void> {
    await (await this.s.target.window(name)).activate();
  }

  async xa11yCloseWindow(name?: string): Promise<void> {
    await (await this.s.target.window(name)).close();
  }

  async xa11yLaunch(app: string, args: string[] = []): Promise<{ pid: number | null; name: string }> {
    const launched = await this.s.target.launch(app, args);
    this.s.tree.forget();
    return { pid: launched.pid, name: launched.name };
  }

  async xa11ySwitchApp(name?: string, pid?: number): Promise<{ pid: number | null; name: string }> {
    const app = await this.s.target.attach({ name, pid });
    this.s.tree.forget();
    return { pid: app.pid, name: app.name };
  }

  async xa11yListApps(): Promise<Array<{ pid: number | null; name: string; foreground: boolean }>> {
    return this.s.target.list();
  }

  async xa11yListWindows() {
    return (await this.s.target.app.windows()).map((w) => ({ name: w.name, role: w.role, active: w.active, bounds: w.bounds }));
  }

  async xa11yActiveAppInfo(): Promise<{ pid: number | null; name: string }> {
    const app = this.s.target.app;
    return { pid: app.pid, name: app.name };
  }

  async activateApp(appId: string): Promise<void> {
    const attached = await this.s.target.attach({ name: appId }, 0).catch(() => undefined);
    if (!attached) {
      await this.xa11yLaunch(appId);
      return;
    }
    this.s.tree.forget();
    await this.s.target.activate();
  }

  async terminateApp(): Promise<boolean> {
    return this.s.target.terminateLaunched();
  }
}
