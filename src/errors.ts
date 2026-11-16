import * as xa from '@crowecawcaw/xa11y';
import { errors } from 'appium/driver';

export interface ErrorContext {
  hint?: string;
  creating?: boolean;
}

/** A failure of the Host that the permission hint can help with. */
export class HostError extends Error {}

const withHint = (m: string, hint = '') => (hint ? `${m}. ${hint}` : m);

function notPermitted(e: Error, ctx: ErrorContext): Error {
  const m = withHint(e.message, ctx.hint);
  return ctx.creating ? new errors.SessionNotCreatedError(m) : new errors.UnknownError(m);
}

type Rule = [new (...args: never[]) => Error, (e: Error, ctx: ErrorContext) => Error];

const RULES: Rule[] = [
  [xa.ElementStaleError, (e) => new errors.StaleElementReferenceError(e.message)],
  [xa.SelectorNotMatchedError, (e) => new errors.NoSuchElementError(e.message)],
  [xa.InvalidActionDataError, (e) => ((e as xa.XA11yError).code === 'XA11Y_NO_ELEMENT_BOUNDS'
    ? new errors.ElementNotInteractableError(e.message)
    : new errors.InvalidArgumentError(e.message))],
  [xa.TimeoutError, (e) => new errors.TimeoutError(e.message)],
  [xa.ActionNotSupportedError, (e) => new errors.InvalidElementStateError(e.message)],
  [xa.InvalidSelectorError, (e) => new errors.InvalidSelectorError(e.message)],
  [xa.PermissionDeniedError, notPermitted],
  [xa.AccessibilityNotEnabledError, notPermitted],
  [xa.PlatformError, (e, ctx) => new errors.UnknownError(withHint(e.message, ctx.hint))],
  [HostError, (e, ctx) => new errors.UnknownError(withHint(e.message, ctx.hint))],
];

export function asWebDriverError(e: unknown, ctx: ErrorContext = {}): unknown {
  if (!(e instanceof Error) || 'w3cStatus' in e) {
    return e;
  }
  const rule = RULES.find(([cls]) => e instanceof cls);
  return rule ? rule[1](e, ctx) : new errors.UnknownError(e.message);
}
