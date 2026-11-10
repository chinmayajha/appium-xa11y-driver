import { randomUUID } from 'node:crypto';
import type { Element, Locator, Rect } from '@crowecawcaw/xa11y';
import { errors } from 'appium/driver';
import type { Platform, Point } from '../platforms';
import type { Target } from '../target';
import { select, toXpath } from './find';
import { attributesOf, snapshot, toXml, type Node, type Path, type Placement } from './snapshot';

export { LOCATOR_STRATEGIES } from './find';

interface Handle {
  el: Element;
  path?: Path;
  locator?: Locator;
}

interface Resolved {
  el: Element;
  top?: Element;
}

const ROLE_ATTRIBUTES = new Set(['role', 'className', 'class']);
const FIND_POLL_MS = 300;

function intersect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const width = Math.min(a.x + a.width, b.x + b.width) - x;
  const height = Math.min(a.y + a.height, b.y + b.height) - y;
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}

function rawAttribute(el: Element, name: string): string | null {
  const raw = el.raw[name];
  return raw === undefined || raw === null ? null : String(raw);
}

/** The Session app's tree: Page source, find, element handles and bounds in Desktop coordinates. */
export class Tree {
  private handles = new Map<string, Handle>();

  constructor(private target: Target, private platform: Platform) {}

  forget(): void {
    this.handles.clear();
  }

  private place = async (node: Node): Promise<Placement> => ({
    rect: await this.platform.elementRect(node.el, node.top),
    id: this.platform.stableId(node.el),
  });

  async source(): Promise<string> {
    return toXml(await snapshot({ el: this.target.app.asElement(), path: [] }, this.place));
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
      const pr = p.role === 'application' ? null : await this.platform.elementRect(p, top);
      r = (pr && intersect(r, pr)) ?? r;
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
    const attrs = attributesOf(el, await this.place({ el, path: [], top }));
    return attrs[name] ?? rawAttribute(el, name);
  }

  private remember(handle: Handle): string {
    const id = randomUUID();
    this.handles.set(id, handle);
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

  private async resolve(id: string): Promise<Resolved> {
    const h = this.handle(id);
    const found = await (h.locator ? h.locator.element().then((el) => ({ el })) : this.walk(h.path ?? [])).catch((e) => {
      throw 'w3cStatus' in e ? e : new errors.StaleElementReferenceError(`The element is no longer in the tree: ${e.message}`);
    });
    if (found.el.role !== h.el.role) {
      throw new errors.StaleElementReferenceError(`Element changed from ${h.el.role} to ${found.el.role}`);
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

  private async byXpath(expr: string, context?: string): Promise<Handle[]> {
    const snap = await snapshot(await this.rootNode(context), this.place);
    return select(snap, expr).map((n) => ({ el: n.el, path: n.path }));
  }

  private async bySelector(selector: string, context?: string): Promise<Handle[]> {
    if (context) {
      throw new errors.InvalidArgumentError('-xa11y selector searches the whole app; use xpath inside an element');
    }
    const locator = this.target.app.locator(selector);
    const els = await locator.elements();
    return els.map((el, i) => ({ el, locator: locator.nth(i + 1) }));
  }
}
