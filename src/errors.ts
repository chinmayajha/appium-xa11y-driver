import { errors } from 'appium/driver';

const MAPPING: Record<string, (msg: string) => Error> = {
  SelectorNotMatchedError: (m) => new errors.NoSuchElementError(m),
  TimeoutError: (m) => new errors.TimeoutError(m),
  ActionNotSupportedError: (m) => new errors.InvalidElementStateError(m),
  InvalidSelectorError: (m) => new errors.InvalidSelectorError(m),
  InvalidActionDataError: (m) => new errors.InvalidArgumentError(m),
  PermissionDeniedError: (m) => new errors.SessionNotCreatedError(
    `${m}. macOS checks the app that started Appium (the terminal, or the launcher that spawned Node), not Node itself.`,
  ),
};

export function asWebDriverError(e: unknown): unknown {
  if (!(e instanceof Error) || 'w3cStatus' in e) {
    return e;
  }
  const make = MAPPING[e.constructor.name];
  return make ? make(e.message) : new errors.UnknownError(e.message);
}
