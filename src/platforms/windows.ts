import { rawString, tap } from './common';
import { NO_FRAME, notSupportedYet, type Platform } from './platform';

const unproven = (call: string) => async (): Promise<never> => {
  throw notSupportedYet('windows', call);
};

export const windows: Platform = {
  os: 'windows',
  primaryModifier: 'Ctrl',
  permissionHint: 'Run Appium in the same desktop session as the app, and at the same or a higher integrity level.',
  launch: unproven('app launch, because the started process can be a launcher that exits; start the app yourself and pass appName'),
  isFrontmost: unproven('the Frontmost app check for raw input'),
  frontmostName: async () => undefined,
  activate: unproven('window activation'),
  wheel: unproven('wheel input'),
  pressKey: tap,
  releaseKeys: unproven('key release'),
  windowShadow: async () => NO_FRAME,
  elementRect: async (el) => el.bounds,
  stableId: (el) => el.stableId ?? '',
  identity: (el) => el.stableId ?? '',
  platformRole: (el) => rawString(el, 'uia_control_type'),
  scrollTypes: new Set(['ScrollViewer']),
  settleAfterReleaseMs: 0,
  runningPid: unproven('the running instance lookup for activateApp and terminateApp'),
  terminate: () => {
    throw notSupportedYet('windows', 'terminate');
  },
};
