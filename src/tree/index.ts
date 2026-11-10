import { randomUUID } from 'node:crypto';
import type { Element, Locator, Rect } from '@crowecawcaw/xa11y';
import { errors } from 'appium/driver';
import { asWebDriverError } from '../errors';
import type { Platform, Point } from '../platforms';
import type { Target } from '../target';
import { select, toXpath } from './find';
import { attributesOf, snapshot, toXml, type Node, type Path, type Placement } from './snapshot';

export { LOCATOR_STRATEGIES } from './find';

interface Found {
  el: Element;
  path?: Path;
  locator?: Locator;
}

interface Handle extends Found {
  pid: number | null;
  identity: string;
  name: string;
}

interface Resolved {
  el: Element;
  top?: Element;
}

const ROLE_ATTRIBUTES = new Set(['role', 'className', 'class']);
const PLACED_ATTRIBUTES = new Set(['x', 'y', 'width', 'height', 'visible', 'id']);
const UNPLACED: Placement = { rect: null, id: '' };
const FIND_POLL_MS = 300;
const MAX_HANDLES = 5000;

function intersect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const width = Math.min(a.x + a.width, b.x + b.width) - x;
  const height = Math.min(a.y + a.height, b.y + b.height) - y;
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}

function clip(r: Rect, container: Rect | null, role: string): Rect {
  if (!container) {
    return r;
  }
  const shown = intersect(r, container);
  if (!shown) {
    throw new errors.ElementNotInteractableError(`The ${role} element is outside the visible part of its container`);
  }
  return shown;
}

function rawAttribute(el: Element, name: string): string | null {
  const raw = el.raw[name];
  return raw === undefined || raw === null ? null : String(raw);
}

/** The Session app's tree: Page source, find, element handles and bounds in Desktop coordinates. */
export class Tree {
  private handles = new Map<string, Handle>();

  constructor(private target: Target, private platform: Platform) {}

  private place = async (node: Node): Promise<Placement> => ({
    rect: await this.platform.elementRect(node.el, node.top),
    id: this.platform.stableId(node.el),
  });

  async source(): Promise<string> {
    return toXml(await snapshot({ el: this.target.app.asElement(), path: [] }, this.place, this.platform));
  }

  async find(strategy: string, selector: string, context: string | undefined, waitMs: number): Promise<string[]> {
    const find = strategy === '-xa11y selector'
      ? () => this.bySelector(selector, context)
      : () => this.byXpath(toXpath(strategy, selector), context);
    const deadline = Date.now() + waitMs;
    let found = await find();
    while (!found.length && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, FIND_POLL_MS));
      found = await find();
    }
    return found.map((h) => this.remember(h));
  }

  async focused(): Promise<string | undefined> {
    const node = (await this.byXpath("//*[@focused='true']")).pop();
    return node && this.remember(node);
  }

  async element(id: string): Promise<Element> {
    return (await this.resolve(id)).el;
  }

  async rect(id: string): Promise<Rect | null> {
    const { el, top } = await this.resolve(id);
    return this.platform.elementRect(el, top);
  }

  /** The part of the element that its scroll areas and window leave visible. */
  async visibleRect(id: string): Promise<Rect> {
    const { el, top } = await this.resolve(id);
    let r = await this.platform.elementRect(el, top);
    if (!r) {
      throw new errors.InvalidElementStateError(`The ${el.role} element has no bounds on the screen`);
    }
    for (let p = await el.parent(); p; p = await p.parent()) {
      r = clip(r, p.role === 'application' ? null : await this.platform.elementRect(p, top), el.role);
    }
    return r;
  }

  /** The Session app's main window, read again so a move or resize shows. */
  async windowRect(): Promise<Rect | null> {
    const win = await this.target.window();
    return this.platform.elementRect(win, win);
  }

  async visibleCenter(id: string): Promise<Point> {
    const r = await this.visibleRect(id);
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }

  async attribute(id: string, name: string): Promise<string | null> {
    const { el, top } = await this.resolve(id);
    if (ROLE_ATTRIBUTES.has(name)) {
      return el.role;
    }
    if (name === 'text') {
      return el.value || el.name || el.description || '';
    }
    const attrs = PLACED_ATTRIBUTES.has(name) ? await this.attributes(el, top) : attributesOf(el, UNPLACED, this.platform);
    return attrs[name] ?? rawAttribute(el, name);
  }

  async state(id: string): Promise<{ enabled: boolean; selected: boolean; displayed: boolean }> {
    const { el, top } = await this.resolve(id);
    const attrs = await this.attributes(el, top);
    return { enabled: el.enabled, selected: el.selected || el.checked === 'on', displayed: attrs.visible === 'true' };
  }

  private async attributes(el: Element, top?: Element): Promise<Record<string, string>> {
    return attributesOf(el, await this.place({ el, path: [], top }), this.platform);
  }

  private remember(found: Found): string {
    if (this.handles.size >= MAX_HANDLES) {
      this.handles.delete(this.handles.keys().next().value as string);
    }
    const id = randomUUID();
    this.handles.set(id, { ...found, pid: this.target.app.pid, identity: this.platform.identity(found.el), name: found.el.name ?? '' });
    return id;
  }

  private handle(id: string): Handle {
    const h = this.handles.get(id);
    if (!h) {
      throw new errors.NoSuchElementError(`Unknown element id '${id}'`);
    }
    return h;
  }

  private async walk(path: Path): Promise<Resolved> {
    let el = this.target.app.asElement();
    let top: Element | undefined;
    for (const i of path) {
      const next = (await el.children())[i];
      if (!next) {
        throw new errors.StaleElementReferenceError('The element is no longer in the tree');
      }
      el = next;
      top ??= el;
    }
    return { el, top };
  }

  private changed(h: Handle, el: Element): string | undefined {
    if (el.role !== h.el.role) {
      return `Element changed from ${h.el.role} to ${el.role}`;
    }
    if (h.identity) {
      return this.platform.identity(el) === h.identity ? undefined : `A different ${el.role} element is now at the place of this one`;
    }
    return h.name && el.name !== h.name ? `The ${el.role} element '${h.name}' is now named '${el.name ?? ''}'` : undefined;
  }

  private async resolve(id: string): Promise<Resolved> {
    const h = this.handle(id);
    if (this.target.app.pid !== h.pid) {
      throw new errors.StaleElementReferenceError('The element belongs to another app');
    }
    const found = await (h.locator ? h.locator.element().then((el) => ({ el })) : this.walk(h.path ?? [])).catch((e) => {
      const err = asWebDriverError(e);
      throw err instanceof errors.NoSuchElementError ? new errors.StaleElementReferenceError(`The element is no longer in the tree: ${err.message}`) : err;
    });
    const change = this.changed(h, found.el);
    if (change) {
      throw new errors.StaleElementReferenceError(change);
    }
    h.el = found.el;
    return found;
  }

  private async rootNode(contextId?: string): Promise<Node> {
    if (!contextId) {
      return { el: this.target.app.asElement(), path: [] };
    }
    const h = this.handle(contextId);
    if (!h.path) {
      throw new errors.InvalidArgumentError('Searching inside an element found by -xa11y selector is not supported; use xpath');
    }
    const { el, top } = await this.resolve(contextId);
    return { el, path: h.path, top: h.path.length === 1 ? undefined : top };
  }

  private async byXpath(expr: string, context?: string): Promise<Found[]> {
    const snap = await snapshot(await this.rootNode(context), this.place, this.platform);
    return select(snap, expr).map((n) => ({ el: n.el, path: n.path }));
  }

  private async bySelector(selector: string, context?: string): Promise<Found[]> {
    if (context) {
      throw new errors.InvalidArgumentError('-xa11y selector searches the whole app; use xpath inside an element');
    }
    const locator = this.target.app.locator(selector);
    const els = await locator.elements();
    return els.map((el, i) => ({ el, locator: locator.nth(i + 1) }));
  }
}
