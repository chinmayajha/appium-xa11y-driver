import { spawnApp } from './common';
import { notSupportedYet, type Platform } from './platform';

const unproven = (call: string) => async (): Promise<never> => {
  throw notSupportedYet('windows', call);
};

export const windows: Platform = {
  os: 'windows',
  primaryModifier: 'Ctrl',
  permissionHint: 'Run Appium in the same desktop session as the app, and at the same or a higher integrity level.',
  launch: async (app, args) => {
    if (app.includes('!')) {
      throw notSupportedYet('windows', `launch of the packaged app '${app}'; start it yourself and pass appName`);
    }
    return spawnApp(app, args);
  },
  isFrontmost: unproven('the Frontmost app check for raw input'),
  frontmostName: async () => undefined,
  activate: unproven('window activation'),
  wheel: unproven('wheel input'),
  releaseKeys: unproven('key release'),
  elementRect: async (el) => el.bounds,
  stableId: (el) => el.stableId ?? '',
};
