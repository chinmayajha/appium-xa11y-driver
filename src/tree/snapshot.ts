import { DOMImplementation, XMLSerializer } from '@xmldom/xmldom';
import type { Element as XmlElement, Document as XmlDocument } from '@xmldom/xmldom';
import type { Element, Rect } from '@crowecawcaw/xa11y';

export type Path = number[];

export interface Node {
  el: Element;
  path: Path;
  /** The top-level window that contains the element, when the walk knows it. */
  top?: Element;
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

const CLICK_ACTIONS = new Set(['press', 'activate', 'open', 'pick', 'show_menu']);
const CLICK_ROLES = new Set([
  'button', 'link', 'menu_item', 'menu', 'check_box', 'radio_button', 'switch', 'tab',
  'list_item', 'tree_item', 'table_row', 'table_cell', 'combo_box', 'slider', 'spin_button',
]);
const CHECK_ROLES = new Set(['check_box', 'radio_button', 'switch']);
const EDIT_ROLES = new Set(['text_field', 'text_area', 'combo_box']);
const SCROLL_ROLES = new Set(['list', 'table', 'web_area', 'text_area']);
const PLATFORM_ROLE_KEYS = ['ax_role', 'uia_control_type', 'atspi_role'];
const PLATFORM_SCROLL_ROLES = new Set(['AXScrollArea', 'ScrollViewer', 'scroll pane']);
const XML_INVALID = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

function platformRole(el: Element): string {
  const raw = el.raw;
  for (const key of PLATFORM_ROLE_KEYS) {
    if (typeof raw[key] === 'string') {
      return raw[key] as string;
    }
  }
  return '';
}

function isScrollable(el: Element, role: string, type: string): boolean {
  return SCROLL_ROLES.has(role) || PLATFORM_SCROLL_ROLES.has(type)
    || el.actions.some((a) => a.startsWith('scroll_') && a !== 'scroll_into_view');
}

function actionFlags(el: Element, role: string, type: string): Record<string, string> {
  const actions = el.actions;
  return {
    clickable: String(CLICK_ROLES.has(role) || actions.some((a) => CLICK_ACTIONS.has(a))),
    checkable: String(CHECK_ROLES.has(role) || el.checked !== null || actions.includes('toggle')),
    editable: String(el.editable || EDIT_ROLES.has(role)),
    scrollable: String(isScrollable(el, role, type)),
  };
}

function boundsOf(rect: Rect | null): Record<string, string> {
  return rect ? Object.fromEntries((['x', 'y', 'width', 'height'] as const).map((k) => [k, String(Math.round(rect[k]))])) : {};
}

export function attributesOf(el: Element, { rect, id }: Placement): Record<string, string> {
  const type = platformRole(el);
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
    ...actionFlags(el, el.role, type),
    ...boundsOf(rect),
  };
}

function tagFor(role: string): string {
  return /^[A-Za-z_][\w-]*$/.test(role) ? role : 'unknown';
}

function topFor(parent: Node, child: Element): Element | undefined {
  if (parent.path.length === 0) {
    return child;
  }
  return parent.top ?? (parent.path.length === 1 ? parent.el : undefined);
}

interface Walk {
  doc: XmlDocument;
  nodes: Map<XmlElement, Node>;
  place: Place;
}

// macOS gives an app with no window itself as its only child, which would make the walk endless.
async function fill(walk: Walk, xml: XmlElement, node: Node): Promise<void> {
  for (const [k, v] of Object.entries(attributesOf(node.el, await walk.place(node)))) {
    xml.setAttribute(k, v.replace(XML_INVALID, '').replace(LONE_SURROGATE, ''));
  }
  walk.nodes.set(xml, node);
  const kids = (await node.el.children())
    .map((el, i) => ({ el, path: [...node.path, i], top: topFor(node, el) }))
    .filter((kid) => kid.el.role !== 'application');
  const xmlKids = kids.map((kid) => xml.appendChild(walk.doc.createElement(tagFor(kid.el.role))) as XmlElement);
  await Promise.all(kids.map((kid, i) => fill(walk, xmlKids[i], kid)));
}

export async function snapshot(root: Node, place: Place): Promise<Snapshot> {
  const doc = new DOMImplementation().createDocument(null, tagFor(root.el.role), null);
  const nodes = new Map<XmlElement, Node>();
  await fill({ doc, nodes, place }, doc.documentElement as XmlElement, root);
  return { doc, nodes };
}

export function toXml(snap: Snapshot): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(snap.doc)}`;
}
