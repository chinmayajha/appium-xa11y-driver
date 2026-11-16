import { DOMImplementation, XMLSerializer } from '@xmldom/xmldom';
import type { Element as XmlElement, Document as XmlDocument } from '@xmldom/xmldom';
import type { Element, Rect } from '@crowecawcaw/xa11y';
import type { Platform } from '../platforms';

export type Path = number[];

export interface Node {
  el: Element;
  path: Path;
}

/** What the Platform adds to an element: bounds in Desktop coordinates and the Stable id. */
export interface Placement {
  rect: Rect | null;
  id: string;
}

export type Place = (node: Node) => Promise<Placement>;

export interface Snapshot {
  doc: XmlDocument;
  nodes: Map<XmlElement, Node>;
}

// Chromium gives every node show_menu (a context menu), so it does not make an element clickable.
const CLICK_ACTIONS = new Set(['press', 'activate', 'open', 'pick']);
// Bringing an element into view does not make it a scroll container; Chromium gives every node this action.
const INTO_VIEW_ACTIONS = new Set(['scroll_into_view', 'scroll_to_visible']);
const CLICK_ROLES = new Set([
  'button', 'link', 'menu_item', 'menu', 'check_box', 'radio_button', 'switch', 'tab',
  'list_item', 'tree_item', 'table_row', 'table_cell', 'combo_box', 'slider', 'spin_button',
]);
const CHECK_ROLES = new Set(['check_box', 'radio_button', 'switch']);
const EDIT_ROLES = new Set(['text_field', 'text_area', 'combo_box']);
const SCROLL_ROLES = new Set(['list', 'table', 'web_area', 'text_area']);
const XML_INVALID = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export type RoleNames = Pick<Platform, 'platformRole' | 'scrollTypes' | 'menuButtonTypes'>;
export type WalkRules = RoleNames & Pick<Platform, 'shownElsewhere'>;

function isScrollable(el: Element, role: string, type: string, scrollTypes: ReadonlySet<string>): boolean {
  return SCROLL_ROLES.has(role) || scrollTypes.has(type)
    || el.actions.some((a) => a.startsWith('scroll_') && !INTO_VIEW_ACTIONS.has(a));
}

function isEditable(el: Element, role: string, type: string, names: RoleNames): boolean {
  if (names.menuButtonTypes.has(type)) {
    return false;
  }
  return el.editable || EDIT_ROLES.has(role) || (role === 'web_area' && el.actions.includes('set_value'));
}

function actionFlags(el: Element, role: string, type: string, names: RoleNames): Record<string, string> {
  const actions = el.actions;
  return {
    clickable: String(CLICK_ROLES.has(role) || actions.some((a) => CLICK_ACTIONS.has(a))),
    checkable: String(CHECK_ROLES.has(role) || el.checked !== null || actions.includes('toggle')),
    editable: String(isEditable(el, role, type, names)),
    scrollable: String(isScrollable(el, role, type, names.scrollTypes)),
  };
}

function boundsOf(rect: Rect | null): Record<string, string> {
  return rect ? Object.fromEntries((['x', 'y', 'width', 'height'] as const).map((k) => [k, String(Math.round(rect[k]))])) : {};
}

export function attributesOf(el: Element, { rect, id }: Placement, names: RoleNames): Record<string, string> {
  const type = names.platformRole(el);
  return {
    type,
    name: el.name ?? '',
    value: el.value ?? '',
    label: el.description ?? '',
    id,
    enabled: String(el.enabled),
    visible: String(el.visible && rect !== null),
    focused: String(el.focused),
    selected: String(el.selected),
    checked: String(el.checked === 'on'),
    ...actionFlags(el, el.role, type, names),
    ...boundsOf(rect),
  };
}

function tagFor(role: string): string {
  return /^[A-Za-z_][\w-]*$/.test(role) ? role : 'unknown';
}

const MAX_DEPTH = 256;
export const UNPLACED: Placement = { rect: null, id: '' };
const MAX_CONCURRENT = 16;

type Limit = <T>(task: () => Promise<T>) => Promise<T>;

/** Runs at most `max` tasks at once; a finished task hands its slot to the next waiting one. */
function limiter(max: number): Limit {
  let running = 0;
  const waiting: Array<() => void> = [];
  return async (task) => {
    if (running < max) {
      running++;
    } else {
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) {
        next();
      } else {
        running--;
      }
    }
  };
}

interface Walk {
  root: Node;
  doc: XmlDocument;
  nodes: Map<XmlElement, Node>;
  place: Place;
  limit: Limit;
  rules: WalkRules;
}

// An element can leave the tree between its parent's children() call and its own calls; it then counts as a leaf.
function read<T>(walk: Walk, node: Node, task: () => Promise<T>, gone: T): Promise<T> {
  const result = walk.limit(task);
  return node === walk.root ? result : result.catch(() => gone);
}

/** The children that the Page source shows at this node, with their raw indexes, so their paths stay the same. */
async function shownKids(walk: Walk, node: Node, parent?: Element): Promise<Node[]> {
  const children = node.path.length >= MAX_DEPTH ? [] : await read(walk, node, () => node.el.children(), []);
  // macOS gives an app with no window itself as its only child, which would make the walk endless.
  const kids = children
    .map((el, i) => ({ el, path: [...node.path, i] }))
    .filter((kid) => kid.el.role !== 'application');
  if (!parent) {
    return kids;
  }
  const elsewhere = await Promise.all(kids.map((kid) => read(walk, kid, () => walk.rules.shownElsewhere(node.el, kid.el, parent), false)));
  return kids.filter((_, i) => !elsewhere[i]);
}

async function fill(walk: Walk, xml: XmlElement, node: Node, parent?: Element): Promise<void> {
  for (const [k, v] of Object.entries(attributesOf(node.el, await read(walk, node, () => walk.place(node), UNPLACED), walk.rules))) {
    xml.setAttribute(k, v.replace(XML_INVALID, '').replace(LONE_SURROGATE, ''));
  }
  walk.nodes.set(xml, node);
  const kids = await shownKids(walk, node, parent);
  const xmlKids = kids.map((kid) => xml.appendChild(walk.doc.createElement(tagFor(kid.el.role))) as XmlElement);
  await Promise.all(kids.map((kid, i) => fill(walk, xmlKids[i], kid, node.el)));
}

export async function snapshot(root: Node, place: Place, rules: WalkRules): Promise<Snapshot> {
  const doc = new DOMImplementation().createDocument(null, tagFor(root.el.role), null);
  const nodes = new Map<XmlElement, Node>();
  await fill({ root, doc, nodes, place, limit: limiter(MAX_CONCURRENT), rules }, doc.documentElement as XmlElement, root);
  return { doc, nodes };
}

export function toXml(snap: Snapshot): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(snap.doc)}`;
}
