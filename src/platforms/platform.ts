import type { App, Element, InputSim, Rect } from '@crowecawcaw/xa11y';
import { errors } from 'appium/driver';

export interface Point {
  x: number;
  y: number;
}

/** What differs between operating systems and xa11y does not cover. */
export interface Platform {
  readonly os: string;
  /** The modifier that `primary` names in a Chord: Meta on macOS, Ctrl elsewhere. */
  readonly primaryModifier: string;
  /** Tells the user what to grant or start when xa11y reports a permission error. */
  readonly permissionHint: string;
  /** Start the app and return the pid of the process that owns its windows. */
  launch(app: string, args: string[], timeoutMs: number): Promise<number>;
  /** Whether the app owns the active window of the Desktop session. */
  isFrontmost(app: App): Promise<boolean>;
  /** The name of the Frontmost app, for error messages. */
  frontmostName(): Promise<string | undefined>;
  /** Make the app's window the active window. */
  activate(app: App, window?: Element): Promise<void>;
  /** Scroll by W3C wheel deltas in pixels: positive dx goes right, positive dy goes down. */
  wheel(input: InputSim, at: Point, dx: number, dy: number): Promise<void>;
  /** Release keys and return when the next synthetic key can no longer carry them. */
  releaseKeys(input: InputSim, keys: string[]): Promise<void>;
  /** Bounds in Desktop coordinates, or null when the toolkit gives none that can be trusted. */
  elementRect(el: Element, topLevel?: Element): Promise<Rect | null>;
  /** The Stable id, or an empty string when the app gives none. */
  stableId(el: Element): string;
  /** A key that names one element for the life of the app process, or an empty string when there is none. */
  identity(el: Element): string;
  /** The OS role name of the element, for the Page source `type` attribute. */
  platformRole(el: Element): string;
  /** OS role names of scroll containers. */
  readonly scrollTypes: ReadonlySet<string>;
  /** Wait after a pointer release before the next pointer event; some toolkits drop a click otherwise. */
  readonly settleAfterReleaseMs: number;
  /** Ask the process, and on Linux its process group, to quit. */
  terminate(pid: number): void;
  /** The pid of a running instance of the app, matched the way launch() reads appId. */
  runningPid(appId: string): Promise<number | undefined>;
}

export function notSupportedYet(os: string, call: string): Error {
  return new errors.NotYetImplementedError(`Not supported yet on ${os}: ${call}`);
}
