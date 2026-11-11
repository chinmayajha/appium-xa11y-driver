import type { App, Element, InputSim, MouseButtonName, Rect } from '@crowecawcaw/xa11y';
import { errors } from 'appium/driver';

export interface Point {
  x: number;
  y: number;
}

/** Margins in points around a rect. */
export interface Frame {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export const NO_FRAME: Frame = { left: 0, right: 0, top: 0, bottom: 0 };

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
  /** Move the pointer to the point; while a button is held, the app gets a drag. */
  movePointer(input: InputSim, to: Point, held: ReadonlySet<MouseButtonName>): Promise<void>;
  /** Press a mouse button at the point, where the pointer is, and keep it down. */
  pressButton(input: InputSim, at: Point, button: MouseButtonName): Promise<void>;
  /** Release a mouse button at the point, where the pointer is. */
  releaseButton(input: InputSim, at: Point, button: MouseButtonName): Promise<void>;
  /** Tap a key and return when the next synthetic key can no longer carry its flags. */
  pressKey(input: InputSim, key: string): Promise<void>;
  /** Release keys and return when the next synthetic key can no longer carry them. */
  releaseKeys(input: InputSim, keys: string[]): Promise<void>;
  /** What the window's move and resize geometry adds around the visible frame that elementRect gives. */
  windowShadow(win: Element): Promise<Frame>;
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
  /** Whether the element typeText of xa11y leaves the caret after the text it inserts; when not, typing goes as Raw input. */
  readonly typeTextMovesCaret: boolean;
  /** Ask the process, and on Linux its process group, to quit. */
  terminate(pid: number): void;
  /** When the process started, or undefined when it does not run or the OS cannot tell; it tells a process from a later one with the same pid. */
  startedAt(pid: number): Promise<string | undefined>;
  /** The pid of a running instance of the app, matched the way launch() reads appId. */
  runningPid(appId: string): Promise<number | undefined>;
}

export function notSupportedYet(os: string, call: string): Error {
  return new errors.NotYetImplementedError(`Not supported yet on ${os}: ${call}`);
}
