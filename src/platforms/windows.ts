import { keyUps, lineWheel, spawnApp } from './common';
import { notSupportedYet, type Platform } from './platform';

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
  wheel: lineWheel,
  releaseKeys: keyUps,
};
