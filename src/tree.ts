import { DOMImplementation, XMLSerializer } from '@xmldom/xmldom';
import type { Element as XmlElement, Document as XmlDocument } from '@xmldom/xmldom';
import type { Element } from '@crowecawcaw/xa11y';

export type Path = number[];

export interface Node {
  el: Element;
  path: Path;
}

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

export function attributesOf(el: Element): Record<string, string> {
  const role = el.role;
  const type = platformRole(el);
  const actions = el.actions;
  const attrs: Record<string, string> = {
    type,
    name: el.name ?? '',
    value: el.value ?? '',
    label: el.description ?? '',
    id: el.stableId ?? '',
    enabled: String(el.enabled),
    visible: String(el.visible),
    focused: String(el.focused),
    selected: String(el.selected),
    clickable: String(CLICK_ROLES.has(role) || actions.some((a) => CLICK_ACTIONS.has(a))),
    checkable: String(CHECK_ROLES.has(role) || el.checked !== null || actions.includes('toggle')),
    editable: String(el.editable || EDIT_ROLES.has(role)),
    scrollable: String(isScrollable(el, role, type)),
  };
  if (el.checked !== null) {
    attrs.checked = String(el.checked === 'on');
  }
  const b = el.bounds;
  if (b) {
    attrs.x = String(Math.round(b.x));
    attrs.y = String(Math.round(b.y));
    attrs.width = String(Math.round(b.width));
    attrs.height = String(Math.round(b.height));
  }
  return attrs;
}

function tagFor(role: string): string {
  return /^[A-Za-z_][\w-]*$/.test(role) ? role : 'unknown';
}

async function fill(doc: XmlDocument, xml: XmlElement, node: Node, nodes: Map<XmlElement, Node>, depthLimit: number): Promise<void> {
  for (const [k, v] of Object.entries(attributesOf(node.el))) {
    xml.setAttribute(k, v.replace(XML_INVALID, ''));
  }
  nodes.set(xml, node);
  if (node.path.length >= depthLimit) {
    return;
  }
  const kids = (await node.el.children()).map((el, i) => ({ el, path: [...node.path, i] }));
  const xmlKids = kids.map((kid) => xml.appendChild(doc.createElement(tagFor(kid.el.role))) as XmlElement);
  await Promise.all(kids.map((kid, i) => fill(doc, xmlKids[i], kid, nodes, depthLimit)));
}

export async function snapshot(root: Node, maxDepth = Infinity): Promise<Snapshot> {
  const doc = new DOMImplementation().createDocument(null, tagFor(root.el.role), null);
  const xml = doc.documentElement as XmlElement;
  const nodes = new Map<XmlElement, Node>();
  await fill(doc, xml, root, nodes, root.path.length + maxDepth);
  return { doc, nodes };
}

export function toXml(snap: Snapshot): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(snap.doc)}`;
}
