import type { InputSim } from '@crowecawcaw/xa11y';
import { errors } from 'appium/driver';

export interface Point {
  x: number;
  y: number;
}

/** What differs between operating systems. Tree access, focus and screenshots go through xa11y on all of them. */
export interface Platform {
  readonly os: string;
  /** The modifier that `primary` names in a chord: Meta on macOS, Ctrl elsewhere. */
  readonly primaryModifier: string;
  /** Tells the user what to grant or start when xa11y reports a permission error. */
  readonly permissionHint: string;
  /** Start the app and return the pid of the process that owns its windows. */
  launch(app: string, args: string[], timeoutMs: number): Promise<number>;
  /** Scroll by W3C wheel deltas in pixels: positive dx goes right, positive dy goes down. */
  wheel(input: InputSim, at: Point, dx: number, dy: number): Promise<void>;
  /** Release keys and return when the next synthetic key can no longer carry them. */
  releaseKeys(input: InputSim, keys: string[]): Promise<void>;
}

export function notSupportedYet(os: string, call: string): Error {
  return new errors.NotYetImplementedError(`Not supported yet on ${os}: ${call}`);
}
