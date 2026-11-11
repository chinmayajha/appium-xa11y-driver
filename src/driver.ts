import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
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
const MAX_FAILURES_KEPT = 50;
const ARTIFACT_NAME = /^\d{4}-\d{2}-\d{2}T[\d-]+Z-\w+\.(xml|png)$/;

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
      await this.saveFailure(cmd);
      throw asWebDriverError(e, { hint: this.session?.platform.permissionHint });
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
        await target.activate().catch(() => undefined);
      }
    } catch (e) {
      const hint = this.session?.platform.permissionHint;
      await this.deleteSession();
      const err = asWebDriverError(e, { hint, creating: true });
      throw err instanceof errors.SessionNotCreatedError ? err : new errors.SessionNotCreatedError((err as Error).message);
    }
    return result;
  }

  async deleteSession(sessionId?: string | null): Promise<void> {
    const s = this.session;
    if (s) {
      await s.input.release().catch(() => undefined);
      if (this.opts.terminateOnDelete !== false) {
        await s.target.terminateLaunched().catch((e: Error) => this.log.warn(`The apps of the session did not stop: ${e.message}`));
      }
    }
    this.session = undefined;
    await super.deleteSession(sessionId);
  }

  /** Saves the Page source and a screenshot of the failed command to the `appium:failureArtifacts` folder. */
  private async saveFailure(cmd: string): Promise<void> {
    const dir = this.opts.failureArtifacts;
    if (!dir || !this.session) {
      return;
    }
    const { tree } = this.session;
    const base = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${cmd}`);
    const save = async (ext: string, data: () => Promise<string | Buffer>) => {
      await writeFile(`${base}.${ext}`, await data());
      this.log.info(`${cmd} failed; saved ${base}.${ext}`);
    };
    const warn = (e: Error) => this.log.warn(`${cmd} failed, and an artifact could not be saved: ${e.message}`);
    await mkdir(dir, { recursive: true }).catch(warn);
    await Promise.all([save('xml', () => tree.source()).catch(warn), save('png', () => this.screen.capture()).catch(warn)]);
    await this.pruneFailures(dir).catch(warn);
  }

  /** Deletes the oldest artifacts of this driver, so the folder keeps the newest failures only; other files stay. */
  private async pruneFailures(dir: string): Promise<void> {
    const stems = [...new Set((await readdir(dir)).filter((f) => ARTIFACT_NAME.test(f)).map((f) => f.replace(/\.(xml|png)$/, '')))].sort();
    const old = stems.slice(0, Math.max(0, stems.length - MAX_FAILURES_KEPT));
    await Promise.all(old.flatMap((stem) => ['xml', 'png'].map((ext) => rm(path.join(dir, `${stem}.${ext}`), { force: true }))));
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
    const ids = await this.s.tree.find(strategy, selector, context, this.implicitWaitMs, mult ? Infinity : 1);
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
    return (await this.s.tree.attribute(id, 'role')) ?? '';
  }

  async getElementRect(id: string) {
    return (await this.s.tree.rect(id)) ?? { x: 0, y: 0, width: 0, height: 0 };
  }

  async elementDisplayed(id: string): Promise<boolean> {
    return (await this.s.tree.state(id)).displayed;
  }

  async elementEnabled(id: string): Promise<boolean> {
    return (await this.s.tree.state(id)).enabled;
  }

  async elementSelected(id: string): Promise<boolean> {
    return (await this.s.tree.state(id)).selected;
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
    return this.s.platform.desktopBounds?.() ?? this.screen.desktop();
  }

  async setWindowRect(x: number | null, y: number | null, width: number | null, height: number | null) {
    await this.s.target.moveWindow({ x, y, width, height });
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
    await this.s.target.focusWindow(name);
  }

  async xa11yCloseWindow(name?: string): Promise<void> {
    await this.s.target.closeWindow(name);
  }

  async xa11yLaunch(app: string, args: string[] = []): Promise<{ pid: number | null; name: string }> {
    const launched = await this.s.target.launch(app, args);
    return { pid: launched.pid, name: launched.name };
  }

  async xa11ySwitchApp(name?: string, pid?: number): Promise<{ pid: number | null; name: string }> {
    const app = await this.s.target.attach({ name, pid });
    return { pid: app.pid, name: app.name };
  }

  async xa11yListApps(): Promise<Array<{ pid: number | null; name: string; foreground: boolean }>> {
    return this.s.target.list();
  }

  async xa11yListWindows() {
    return this.s.target.windows();
  }

  async xa11yActiveAppInfo(): Promise<{ pid: number | null; name: string }> {
    const app = this.s.target.app;
    return { pid: app.pid, name: app.name };
  }

  async activateApp(appId: string): Promise<void> {
    await this.s.target.activateOrLaunch(appId);
  }

  async terminateApp(appId: string): Promise<boolean> {
    return this.s.target.terminate(appId);
  }
}
