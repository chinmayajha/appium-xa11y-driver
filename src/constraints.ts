export const desiredCapConstraints = {
  platformName: { presence: true, isString: true, inclusionCaseInsensitive: ['Mac', 'Windows', 'Linux'] },
  app: { isString: true },
  appName: { isString: true },
  appArguments: { isArray: true },
  launchTimeout: { isNumber: true },
  terminateOnDelete: { isBoolean: true },
} as const;

export type Xa11yConstraints = typeof desiredCapConstraints;
