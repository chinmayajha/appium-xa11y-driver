import { randomUUID } from 'node:crypto';
import {
  App, Element, Locator, Screenshot, inputSim, screenshot, type InputSim, type Rect,
} from '@crowecawcaw/xa11y';
import { BaseDriver, errors } from 'appium/driver';
import type { DefaultCreateSessionResult, DriverData, ExecuteMethodMap, W3CDriverCaps } from '@appium/types';
import xpath from 'xpath';
import type { Element as XmlElement } from '@xmldom/xmldom';
import { perform, pressChord, release, newInputState, type ActionContext, type ActionSequence, type Point } from './actions';
import { attach, terminate } from './app';
import { desiredCapConstraints, type Xa11yConstraints } from './constraints';
import { isSpecialKey, parseChord, w3cKey } from './keys';
import { attributesOf, snapshot, toXml, type Node, type Path } from './tree';
import { asWebDriverError } from './errors';
import { currentPlatform, type Platform } from './platforms';

interface Handle {
  el: Element;
  path?: Path;
  locator?: Locator;
}

const W3C_ELEMENT_KEY = 'element-6066-11e4-a52e-4f304d4c4746';
// Raw keyboard input on Linux cannot type control characters, so they are sent as the keys that make them.
const CONTROL_KEYS: Record<string, string> = { '\n': 'Enter', '\r': 'Enter', '\t': 'Tab' };

function keyFor(ch: string, viaValue: boolean): string | undefined {
  if (isSpecialKey(ch)) {
    return w3cKey(ch);
  }
  return viaValue ? undefined : CONTROL_KEYS[ch];
}

const LOCATOR_STRATEGIES = ['xpath', 'accessibility id', 'class name', 'id', 'name', '-xa11y selector'];

function quoteXpath(s: string): string {
  if (!s.includes("'")) {
    return `'${s}'`;
  }
  return `concat('${s.split("'").join(`', "'", '`)}')`;
}

function toXpath(strategy: string, selector: string): string {
  const v = quoteXpath(selector);
  switch (strategy) {
    case 'xpath': return selector;
    case 'accessibility id': return `//*[@id=${v} or @name=${v}]`;
    case 'id': return `//*[@id=${v}]`;
    case 'name': return `//*[@name=${v}]`;
    case 'class name': return `//${selector}`;
    default: throw new errors.InvalidSelectorError(`Unsupported locator strategy '${strategy}'`);
  }
}

async function isForeground(app: App): Promise<boolean> {
  const front = await App.foreground({ timeout: 0 }).catch(() => undefined);
  return front?.pid === app.pid;
}

async function waitFor(check: () => Promise<boolean>, ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline && !(await check())) {
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** Center of the part of the element that its ancestors (scroll areas, the window) leave visible. */
async function visibleBounds(el: Element): Promise<Rect> {
  let r = el.bounds;
  if (!r) {
    throw new errors.InvalidElementStateError(`The ${el.role} element has no bounds`);
  }
  for (let p = await el.parent(); p; p = await p.parent()) {
    r = (p.bounds && intersect(r, p.bounds)) ?? r;
  }
  return r;
}

async function visibleCenter(el: Element): Promise<Point> {
  const r = await visibleBounds(el);
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

function intersect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const width = Math.min(a.x + a.width, b.x + b.width) - x;
  const height = Math.min(a.y + a.height, b.y + b.height) - y;
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}

const ROLE_ATTRIBUTES = new Set(['role', 'className', 'class']);

function rawAttribute(el: Element, name: string): string | null {
  const raw = el.raw[name];
  return raw === undefined || raw === null ? null : String(raw);
}

function desktopRect(shot: Screenshot) {
  const [x0, y0] = shot.imageToDesktop(0, 0);
  const [x1, y1] = shot.imageToDesktop(shot.width - 1, shot.height - 1);
  const scale = shot.width > 1 ? (x1 - x0) / (shot.width - 1) : 1;
  return { x: Math.round(x0), y: Math.round(y0), width: Math.round(shot.width * scale), height: Math.round(shot.height * scale) };
}

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

  private app?: App;
  private launchedPids: number[] = [];
  private display?: { x: number; y: number; width: number; height: number };
  private handles = new Map<string, Handle>();
  private platform?: Platform;
  private input = inputSim();
  private inputState = newInputState();

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
      throw asWebDriverError(e, this.platform?.permissionHint);
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
      this.platform = currentPlatform();
      const timeout = this.opts.launchTimeout ?? 20000;
      if (this.opts.app) {
        const pid = await this.platform.launch(this.opts.app, this.opts.appArguments ?? [], timeout);
        this.launchedPids.push(pid);
        this.app = await attach({ pid }, timeout);
      } else {
        this.app = await attach({ name: this.opts.appName }, timeout);
      }
    } catch (e) {
      await this.deleteSession();
      throw asWebDriverError(e, this.platform?.permissionHint);
    }
    return result;
  }

  async deleteSession(sessionId?: string | null): Promise<void> {
    if (this.platform) {
      await release(this.actionContext()).catch(() => undefined);
    }
    if (this.opts.terminateOnDelete !== false) {
      this.launchedPids.forEach(terminate);
    }
    this.launchedPids = [];
    this.handles.clear();
    this.app = undefined;
    this.platform = undefined;
    await super.deleteSession(sessionId);
  }

  private requireApp(): App {
    if (!this.app) {
      throw new errors.NoSuchWindowError('No application is attached to this session');
    }
    return this.app;
  }

  private remember(handle: Handle): Record<string, string> {
    const id = randomUUID();
    this.handles.set(id, handle);
    return { [W3C_ELEMENT_KEY]: id, ELEMENT: id };
  }

  private handle(id: string): Handle {
    const h = this.handles.get(id);
    if (!h) {
      throw new errors.NoSuchElementError(`Unknown element id '${id}'`);
    }
    return h;
  }

  private async resolvePath(path: Path): Promise<Element> {
    let el = this.requireApp().asElement();
    for (const i of path) {
      const next = (await el.children())[i];
      if (!next) {
        throw new errors.StaleElementReferenceError('The element is no longer in the tree');
      }
      el = next;
    }
    return el;
  }

  private async fresh(id: string): Promise<Element> {
    const h = this.handle(id);
    const el = h.locator ? await h.locator.element() : await this.resolvePath(h.path ?? []);
    if (el.role !== h.el.role) {
      throw new errors.StaleElementReferenceError(`Element changed from ${h.el.role} to ${el.role}`);
    }
    h.el = el;
    return el;
  }

  private async rootNode(contextId?: string): Promise<Node> {
    if (!contextId) {
      return { el: this.requireApp().asElement(), path: [] };
    }
    const h = this.handle(contextId);
    if (!h.path) {
      throw new errors.InvalidArgumentError('Searching inside an element found by -xa11y selector is not supported; use xpath');
    }
    return { el: await this.fresh(contextId), path: h.path };
  }

  async findElOrEls(strategy: string, selector: string, mult: true, context?: string): Promise<any[]>;
  async findElOrEls(strategy: string, selector: string, mult: false, context?: string): Promise<any>;
  async findElOrEls(strategy: string, selector: string, mult: boolean, context?: string): Promise<any> {
    const find = strategy === '-xa11y selector'
      ? () => this.findBySelector(selector, context)
      : () => this.findByXpath(toXpath(strategy, selector), context);
    const deadline = Date.now() + this.implicitWaitMs;
    let found = await find();
    while (!found.length && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 300));
      found = await find();
    }
    if (mult) {
      return found.map((h) => this.remember(h));
    }
    if (!found.length) {
      throw new errors.NoSuchElementError(`No element matches ${strategy} '${selector}'`);
    }
    return this.remember(found[0]);
  }

  private async findByXpath(expr: string, context?: string): Promise<Handle[]> {
    const snap = await snapshot(await this.rootNode(context));
    let matches: unknown;
    try {
      matches = xpath.select(expr, snap.doc as unknown as globalThis.Node);
    } catch (e) {
      throw new errors.InvalidSelectorError(`Invalid xpath '${expr}': ${(e as Error).message}`);
    }
    const list = Array.isArray(matches) ? matches : [];
    return list
      .map((n) => snap.nodes.get(n as XmlElement))
      .filter((n): n is Node => Boolean(n))
      .map((n) => ({ el: n.el, path: n.path }));
  }

  private async findBySelector(selector: string, context?: string): Promise<Handle[]> {
    if (context) {
      throw new errors.InvalidArgumentError('-xa11y selector searches the whole app; use xpath inside an element');
    }
    const locator = this.requireApp().locator(selector);
    const els = await locator.elements();
    return els.map((el, i) => ({ el, locator: locator.nth(i + 1) }));
  }

  async getPageSource(): Promise<string> {
    return toXml(await snapshot({ el: this.requireApp().asElement(), path: [] }));
  }

  async click(id: string): Promise<void> {
    const el = await this.fresh(id);
    if (el.actions.includes('press')) {
      await el.press();
    } else {
      await this.rawClick(el);
    }
  }

  private async rawClick(el: Element): Promise<void> {
    const at = await visibleCenter(el);
    await (await this.foregroundInput()).click([at.x, at.y]);
  }

  async setValue(text: string | string[], id: string): Promise<void> {
    const el = await this.fresh(id);
    await el.focus().catch(() => this.rawClick(el));
    await this.typeKeys(Array.isArray(text) ? text.join('') : text, el);
  }

  private async typeKeys(text: string, into?: Element): Promise<void> {
    const viaValue = into?.actions.includes('set_value') ?? false;
    const typeRun = async (run: string) => {
      await (viaValue ? into!.typeText(run) : (await this.foregroundInput()).typeText(run));
    };
    let run = '';
    for (const ch of text) {
      const key = keyFor(ch, viaValue);
      if (!key) {
        run += ch;
        continue;
      }
      if (run) {
        await typeRun(run);
        run = '';
      }
      await (await this.foregroundInput()).press(key);
    }
    if (run) {
      await typeRun(run);
    }
  }

  private async foregroundInput(): Promise<InputSim> {
    const app = this.requireApp();
    if (!(await isForeground(app))) {
      await (await this.mainWindow()).activate().catch(() => undefined);
      await waitFor(() => isForeground(app), 1000);
    }
    if (!(await isForeground(app))) {
      const front = await App.foreground({ timeout: 0 }).catch(() => undefined);
      throw new errors.InvalidElementStateError(
        `${app.name} is not the foreground app (${front?.name ?? 'unknown'} is), so keyboard and mouse input would reach that app`,
      );
    }
    return this.input;
  }

  async clear(id: string): Promise<void> {
    await (await this.fresh(id)).setValue('');
  }

  async getText(id: string): Promise<string> {
    return (await this.getAttribute('text', id)) ?? '';
  }

  async getAttribute(name: string, id: string): Promise<string | null> {
    const el = await this.fresh(id);
    if (ROLE_ATTRIBUTES.has(name)) {
      return el.role;
    }
    if (name === 'text') {
      return el.value || el.name || el.description || '';
    }
    return attributesOf(el)[name] ?? rawAttribute(el, name);
  }

  async getProperty(name: string, id: string): Promise<string | null> {
    return this.getAttribute(name, id);
  }

  async getName(id: string): Promise<string> {
    return (await this.fresh(id)).role;
  }

  async getElementRect(id: string) {
    const attrs = attributesOf(await this.fresh(id));
    return { x: Number(attrs.x ?? 0), y: Number(attrs.y ?? 0), width: Number(attrs.width ?? 0), height: Number(attrs.height ?? 0) };
  }

  async elementDisplayed(id: string): Promise<boolean> {
    return (await this.fresh(id)).visible;
  }

  async elementEnabled(id: string): Promise<boolean> {
    return (await this.fresh(id)).enabled;
  }

  async elementSelected(id: string): Promise<boolean> {
    const el = await this.fresh(id);
    return el.selected || el.checked === 'on';
  }

  async active(): Promise<any> {
    const node = (await this.findByXpath("//*[@focused='true']")).pop();
    if (!node) {
      throw new errors.NoSuchElementError('No element has keyboard focus');
    }
    return this.remember(node);
  }

  private toPng(shot: Screenshot): string {
    const { width, height } = desktopRect(shot);
    return (width === shot.width && height === shot.height ? shot : shot.resize(width, height)).toPng().toString('base64');
  }

  async getScreenshot(): Promise<string> {
    return this.toPng(await screenshot());
  }

  async getElementScreenshot(id: string): Promise<string> {
    return this.toPng(await screenshot({ region: await visibleBounds(await this.fresh(id)) }));
  }

  private requirePlatform(): Platform {
    if (!this.platform) {
      throw new errors.NoSuchDriverError('No session is running');
    }
    return this.platform;
  }

  private actionContext(): ActionContext {
    return {
      platform: this.requirePlatform(),
      input: this.input,
      state: this.inputState,
      elementCenter: async (id: string): Promise<Point> => visibleCenter(await this.fresh(id)),
    };
  }

  async performActions(actions: ActionSequence[]): Promise<void> {
    await this.foregroundInput();
    await perform(this.actionContext(), actions);
  }

  async releaseActions(): Promise<void> {
    await release(this.actionContext());
  }

  private async mainWindow(name?: string): Promise<Element> {
    const windows = await this.requireApp().windows();
    const win = name ? windows.find((w) => w.name === name) : windows.find((w) => w.active) ?? windows[0];
    if (!win) {
      throw new errors.NoSuchWindowError(name ? `No window named '${name}'` : 'The app has no window');
    }
    return win;
  }

  async getWindowRect() {
    this.display ??= await this.displayRect();
    return this.display;
  }

  private async displayRect() {
    return desktopRect(await screenshot());
  }

  async setWindowRect(x: number, y: number, width: number, height: number) {
    const win = await this.mainWindow();
    if (x !== null && y !== null) {
      await win.moveTo(x, y);
    }
    if (width !== null && height !== null) {
      await win.resizeTo(width, height);
    }
    const b = win.bounds ?? { x, y, width, height };
    return { x: b.x, y: b.y, width: b.width, height: b.height };
  }

  async execute(script: string, args: unknown[]): Promise<unknown> {
    if (!script.trim().startsWith('xa11y:')) {
      throw new errors.NotImplementedError(`Only 'xa11y:' execute methods are supported, got '${script}'`);
    }
    return this.executeMethod(script.trim().replace(/^xa11y:\s*/, 'xa11y: '), args);
  }

  async xa11yChord(keys: string): Promise<void> {
    const platform = this.requirePlatform();
    const chord = parseChord(keys, platform.primaryModifier);
    await pressChord(platform, await this.foregroundInput(), chord.key, chord.held);
  }

  async xa11yTypeText(text: string): Promise<void> {
    await this.typeKeys(text);
  }

  async xa11yFocusWindow(name?: string): Promise<void> {
    await (await this.mainWindow(name)).activate();
  }

  async xa11yCloseWindow(name?: string): Promise<void> {
    await (await this.mainWindow(name)).close();
  }

  async xa11yLaunch(app: string, args: string[] = []): Promise<{ pid: number; name: string }> {
    const pid = await this.requirePlatform().launch(app, args, this.opts.launchTimeout ?? 20000);
    this.launchedPids.push(pid);
    this.app = await attach({ pid }, this.opts.launchTimeout ?? 20000);
    this.handles.clear();
    return { pid, name: this.app.name };
  }

  async xa11ySwitchApp(name?: string, pid?: number): Promise<{ pid: number | null; name: string }> {
    this.app = await attach({ name, pid }, this.opts.launchTimeout ?? 20000);
    this.handles.clear();
    return { pid: this.app.pid, name: this.app.name };
  }

  async xa11yListApps(): Promise<Array<{ pid: number | null; name: string; foreground: boolean }>> {
    return (await App.list()).map((a) => ({ pid: a.pid, name: a.name, foreground: a.isForeground }));
  }

  async xa11yListWindows() {
    return (await this.requireApp().windows()).map((w) => ({ name: w.name, role: w.role, active: w.active, bounds: w.bounds }));
  }

  async xa11yActiveAppInfo(): Promise<{ pid: number | null; name: string }> {
    const app = this.requireApp();
    return { pid: app.pid, name: app.name };
  }

  async activateApp(appId: string): Promise<void> {
    const running = await App.byName(appId, { timeout: 0 }).catch(() => undefined);
    if (running) {
      this.app = running;
      this.handles.clear();
    } else {
      await this.xa11yLaunch(appId);
    }
    await (await this.mainWindow()).activate().catch(() => undefined);
  }

  async terminateApp(): Promise<boolean> {
    const had = this.launchedPids.length > 0;
    this.launchedPids.forEach(terminate);
    this.launchedPids = [];
    return had;
  }
}
