import { keyUps, lineWheel, spawnApp } from './common';
import type { Platform } from './platform';

export const linux: Platform = {
  os: 'linux',
  primaryModifier: 'Ctrl',
  permissionHint: 'Start a D-Bus session and the AT-SPI bus, and set org.a11y.Status IsEnabled to true (see docker/linux/entrypoint.sh).',
  launch: async (app, args) => spawnApp(app, args),
  wheel: lineWheel,
  releaseKeys: keyUps,
};
