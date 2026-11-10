import { linux } from './linux';
import { mac } from './mac';
import { notSupportedYet, type Platform } from './platform';
import { windows } from './windows';

export type { Platform, Point } from './platform';

const PLATFORMS: Partial<Record<NodeJS.Platform, Platform>> = { darwin: mac, linux, win32: windows };

export function currentPlatform(os: NodeJS.Platform = process.platform): Platform {
  const platform = PLATFORMS[os];
  if (!platform) {
    throw notSupportedYet(os, 'sessions');
  }
  return platform;
}
