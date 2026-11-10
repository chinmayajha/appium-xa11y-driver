import { errors } from 'appium/driver';

const MAPPING: Record<string, (msg: string, hint: string) => Error> = {
  SelectorNotMatchedError: (m) => new errors.NoSuchElementError(m),
  TimeoutError: (m) => new errors.TimeoutError(m),
  ActionNotSupportedError: (m) => new errors.InvalidElementStateError(m),
  InvalidSelectorError: (m) => new errors.InvalidSelectorError(m),
  InvalidActionDataError: (m) => new errors.InvalidArgumentError(m),
  PermissionDeniedError: (m, hint) => new errors.SessionNotCreatedError(hint ? `${m}. ${hint}` : m),
};

export function asWebDriverError(e: unknown, permissionHint = ''): unknown {
  if (!(e instanceof Error) || 'w3cStatus' in e) {
    return e;
  }
  const make = MAPPING[e.constructor.name];
  return make ? make(e.message, permissionHint) : new errors.UnknownError(e.message);
}
