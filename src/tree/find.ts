import { errors } from 'appium/driver';
import xpath from 'xpath';
import type { Element as XmlElement } from '@xmldom/xmldom';
import type { Node, Snapshot } from './snapshot';

export const LOCATOR_STRATEGIES = ['xpath', 'accessibility id', 'class name', 'id', 'name', '-xa11y selector'];

function quoteXpath(s: string): string {
  if (!s.includes("'")) {
    return `'${s}'`;
  }
  return `concat('${s.split("'").join(`', "'", '`)}')`;
}

/** The XPath forms of a locator, in order of preference: the first form that matches wins. */
export function toXpaths(strategy: string, selector: string): string[] {
  const v = quoteXpath(selector);
  switch (strategy) {
    case 'xpath': return [selector];
    case 'accessibility id': return [`//*[@id=${v}]`, `//*[@name=${v}]`];
    case 'id': return [`//*[@id=${v}]`];
    case 'name': return [`//*[@name=${v}]`];
    case 'class name': return [`//${selector}`];
    default: throw new errors.InvalidSelectorError(`Unsupported locator strategy '${strategy}'`);
  }
}

/** The elements that the XPath selects below the snapshot root; a context element is not a match of its own find. */
export function select(snap: Snapshot, expr: string, context: boolean): Node[] {
  const root = snap.doc.documentElement as XmlElement;
  let matches: unknown;
  try {
    matches = xpath.select(expr, (context ? root : snap.doc) as unknown as globalThis.Node);
  } catch (e) {
    throw new errors.InvalidSelectorError(`Invalid xpath '${expr}': ${(e as Error).message}`);
  }
  const nodes = Array.isArray(matches) ? matches.map((n) => snap.nodes.get(n as XmlElement)) : [undefined];
  if (nodes.some((n) => !n)) {
    throw new errors.InvalidSelectorError(`The xpath '${expr}' selects something that is not an element`);
  }
  return (nodes as Node[]).filter((n) => !context || n !== snap.nodes.get(root));
}
