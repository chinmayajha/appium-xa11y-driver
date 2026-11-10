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

export function toXpath(strategy: string, selector: string): string {
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

export function select(snap: Snapshot, expr: string): Node[] {
  let matches: unknown;
  try {
    matches = xpath.select(expr, snap.doc as unknown as globalThis.Node);
  } catch (e) {
    throw new errors.InvalidSelectorError(`Invalid xpath '${expr}': ${(e as Error).message}`);
  }
  return (Array.isArray(matches) ? matches : [])
    .map((n) => snap.nodes.get(n as XmlElement))
    .filter((n): n is Node => Boolean(n));
}
