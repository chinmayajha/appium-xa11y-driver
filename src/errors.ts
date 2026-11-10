import * as xa from '@crowecawcaw/xa11y';
import { errors } from 'appium/driver';

export interface ErrorContext {
  hint?: string;
  creating?: boolean;
}

// xa11y 0.15.4 drops the error code on typed errors (docs/xa11y-gaps.md, item 14), so the message is the fallback.
export const STALE_TEXT = /^(Element stale|stale window handle)/;
export const NO_BOUNDS_TEXT = /^Element has no bounds/;

function is(e: Error, code: string, text: RegExp): boolean {
  const known = (e as { code?: string }).code;
  return known === undefined ? text.test(e.message) : known === code;
}

const withHint = (m: string, hint = '') => (hint ? `${m}. ${hint}` : m);

function notPermitted(e: Error, ctx: ErrorContext): Error {
  const m = withHint(e.message, ctx.hint);
  return ctx.creating ? new errors.SessionNotCreatedError(m) : new errors.UnknownError(m);
}

type Rule = [new (...args: never[]) => Error, (e: Error, ctx: ErrorContext) => Error];

const RULES: Rule[] = [
  [xa.SelectorNotMatchedError, (e) => (is(e, 'XA11Y_ELEMENT_STALE', STALE_TEXT)
    ? new errors.StaleElementReferenceError(e.message)
    : new errors.NoSuchElementError(e.message))],
  [xa.InvalidActionDataError, (e) => (is(e, 'XA11Y_NO_ELEMENT_BOUNDS', NO_BOUNDS_TEXT)
    ? new errors.ElementNotInteractableError(e.message)
    : new errors.InvalidArgumentError(e.message))],
  [xa.TimeoutError, (e) => new errors.TimeoutError(e.message)],
  [xa.ActionNotSupportedError, (e) => new errors.InvalidElementStateError(e.message)],
  [xa.InvalidSelectorError, (e) => new errors.InvalidSelectorError(e.message)],
  [xa.PermissionDeniedError, notPermitted],
  [xa.AccessibilityNotEnabledError, notPermitted],
  [xa.PlatformError, (e, ctx) => new errors.UnknownError(withHint(e.message, ctx.hint))],
];

export function asWebDriverError(e: unknown, ctx: ErrorContext = {}): unknown {
  if (!(e instanceof Error) || 'w3cStatus' in e) {
    return e;
  }
  const rule = RULES.find(([cls]) => e instanceof cls);
  return rule ? rule[1](e, ctx) : new errors.UnknownError(e.message);
}
