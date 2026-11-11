import type { InputSim, MouseButtonName, Rect } from '@crowecawcaw/xa11y';
import { errors } from 'appium/driver';
import { MODIFIERS, w3cKey } from './keys';
import type { Platform, Point } from '../platforms';

export type { Point };

interface Action {
  type: string;
  duration?: number;
  value?: string;
  button?: number;
  x?: number;
  y?: number;
  deltaX?: number;
  deltaY?: number;
  origin?: string | Record<string, string>;
}

export interface ActionSequence {
  type: 'pointer' | 'key' | 'wheel' | 'none';
  id: string;
  actions: Action[];
}

export interface InputState {
  pointer: Point;
  /** False when the OS pointer may be away from `pointer`. */
  synced: boolean;
  buttons: Set<MouseButtonName>;
  keys: Set<string>;
  releasedAt: number;
}

export interface ActionContext {
  platform: Platform;
  input: InputSim;
  state: InputState;
  /** The Frontmost guard, called before each Raw input event except a release. */
  guard: () => Promise<void>;
  elementCenter: (elementId: string) => Promise<Point>;
  desktop: () => Promise<Rect>;
}

const BUTTONS: MouseButtonName[] = ['left', 'middle', 'right'];
const MOVE_STEP_MS = 16;
const DRAG_MIN_STEPS = 5;
const MAX_MOVE_STEPS = 120;

export function newInputState(): InputState {
  return { pointer: { x: 0, y: 0 }, synced: false, buttons: new Set(), keys: new Set(), releasedAt: 0 };
}

async function afterRelease(ctx: ActionContext): Promise<void> {
  const wait = ctx.state.releasedAt + ctx.platform.settleAfterReleaseMs - Date.now();
  if (wait > 0) {
    await new Promise((r) => setTimeout(r, wait));
  }
}

function heldModifiers(state: InputState): string[] {
  return [...state.keys].filter((k) => MODIFIERS.has(k));
}

async function originOf(ctx: ActionContext, origin: unknown): Promise<Point> {
  if (origin === 'viewport') {
    return { x: 0, y: 0 };
  }
  if (origin === 'pointer') {
    return ctx.state.pointer;
  }
  const id = origin && typeof origin === 'object' ? Object.values(origin)[0] : undefined;
  if (typeof id !== 'string') {
    throw new errors.InvalidArgumentError(`Unknown pointer origin ${JSON.stringify(origin)}`);
  }
  return ctx.elementCenter(id);
}

async function resolvePoint(ctx: ActionContext, a: Action): Promise<Point> {
  const o = await originOf(ctx, a.origin ?? 'viewport');
  return { x: o.x + (a.x ?? 0), y: o.y + (a.y ?? 0) };
}

function buttonOf(a: Action): MouseButtonName {
  const button = BUTTONS[a.button ?? 0];
  if (!button) {
    throw new errors.UnsupportedOperationError(`Pointer button ${a.button} is not supported; use 0 (left), 1 (middle) or 2 (right)`);
  }
  return button;
}

async function onDesktop(ctx: ActionContext, to: Point): Promise<Point> {
  const d = await ctx.desktop();
  if (to.x < d.x || to.y < d.y || to.x >= d.x + d.width || to.y >= d.y + d.height) {
    throw new errors.MoveTargetOutOfBoundsError(`(${to.x}, ${to.y}) is outside the desktop ${JSON.stringify(d)}`);
  }
  return to;
}

async function atPointer(ctx: ActionContext): Promise<void> {
  if (!ctx.state.synced) {
    await ctx.input.moveTo([ctx.state.pointer.x, ctx.state.pointer.y]);
    ctx.state.synced = true;
  }
}

function moveSteps(duration: number, dragging: boolean): number {
  const timed = Math.ceil(duration / MOVE_STEP_MS);
  return Math.min(MAX_MOVE_STEPS, Math.max(dragging ? DRAG_MIN_STEPS : 1, timed));
}

function pairedPointerUp(a: Action, next: Action | undefined): boolean {
  return next?.type === 'pointerUp' && buttonOf(next) === buttonOf(a);
}

function pairedKeyUp(key: string, next: Action | undefined): boolean {
  return !MODIFIERS.has(key) && next?.type === 'keyUp' && w3cKey(next.value ?? '') === key;
}

function clickCount(a: Action, rest: Action[]): number {
  if (!pairedPointerUp(a, rest[0])) {
    return 0;
  }
  const again = rest[1]?.type === 'pointerDown' && buttonOf(rest[1]) === buttonOf(a) && pairedPointerUp(rest[1], rest[2]);
  return again ? 2 : 1;
}

/** A platform that needs a settle after a release gets the clicks one by one, so its toolkit sees each press. */
async function click(ctx: ActionContext, button: MouseButtonName, count: number): Promise<void> {
  const each = ctx.platform.settleAfterReleaseMs > 0 ? 1 : count;
  for (let sent = 0; sent < count; sent += each) {
    await afterRelease(ctx);
    await ctx.guard();
    await ctx.input.click([ctx.state.pointer.x, ctx.state.pointer.y], { button, count: each, held: heldModifiers(ctx.state) });
    ctx.state.releasedAt = Date.now();
  }
  ctx.state.synced = true;
}

type Handler = (ctx: ActionContext, a: Action, rest: Action[]) => Promise<number>;

const ACTIONS: Record<string, Handler> = {
  async pointerMove(ctx, a) {
    const to = await onDesktop(ctx, await resolvePoint(ctx, a));
    await afterRelease(ctx);
    const from = ctx.state.pointer;
    const steps = ctx.state.synced ? moveSteps(a.duration ?? 0, ctx.state.buttons.size > 0) : 1;
    const wait = steps > 1 ? Math.max(MOVE_STEP_MS, (a.duration ?? 0) / steps) : 0;
    for (let i = 1; i <= steps; i++) {
      await ctx.guard();
      ctx.state.pointer = { x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps };
      await ctx.input.moveTo([ctx.state.pointer.x, ctx.state.pointer.y]);
      ctx.state.synced = true;
      if (wait && i < steps) {
        await new Promise((r) => setTimeout(r, wait));
      }
    }
    return 0;
  },
  async pointerDown(ctx, a, rest) {
    const button = buttonOf(a);
    const count = clickCount(a, rest);
    if (count) {
      await click(ctx, button, count);
      return count * 2 - 1;
    }
    await afterRelease(ctx);
    await ctx.guard();
    await atPointer(ctx);
    ctx.state.buttons.add(button);
    await ctx.input.mouseDown(button);
    return 0;
  },
  async pointerUp(ctx, a) {
    const button = buttonOf(a);
    ctx.state.buttons.delete(button);
    await atPointer(ctx);
    await ctx.input.mouseUp(button);
    ctx.state.releasedAt = Date.now();
    return 0;
  },
  async keyDown(ctx, a, rest) {
    const key = w3cKey(a.value ?? '');
    await ctx.guard();
    if (pairedKeyUp(key, rest[0])) {
      await ctx.platform.pressKey(ctx.input, key);
      return 1;
    }
    ctx.state.keys.add(key);
    await ctx.input.keyDown(key);
    return 0;
  },
  async keyUp(ctx, a) {
    const key = w3cKey(a.value ?? '');
    ctx.state.keys.delete(key);
    await ctx.platform.releaseKeys(ctx.input, [key]);
    return 0;
  },
  async scroll(ctx, a) {
    const at = await onDesktop(ctx, await resolvePoint(ctx, a));
    await afterRelease(ctx);
    await ctx.guard();
    ctx.state.synced = false;
    await ctx.platform.wheel(ctx.input, at, a.deltaX ?? 0, a.deltaY ?? 0);
    return 0;
  },
};

// xa11y's chord does not wait for its modifier release, so a key sent right after it can still carry the modifiers.
export async function pressChord(platform: Platform, input: InputSim, key: string, held: string[]): Promise<void> {
  const down: string[] = [];
  try {
    for (const m of held) {
      await input.keyDown(m);
      down.push(m);
    }
    await platform.pressKey(input, key);
  } finally {
    await platform.releaseKeys(input, down.reverse());
  }
}

async function dispatch(ctx: ActionContext, a: Action, rest: Action[]): Promise<number> {
  if (a.type === 'pointerCancel') {
    throw new errors.UnsupportedOperationError('pointerCancel is not supported');
  }
  const handler = ACTIONS[a.type];
  if (!handler) {
    throw new errors.InvalidArgumentError(`Unknown action type '${a.type}'`);
  }
  return handler(ctx, a, rest);
}

export async function perform(ctx: ActionContext, sequences: ActionSequence[]): Promise<void> {
  try {
    await performTicks(ctx, sequences);
  } catch (e) {
    await release(ctx).catch(() => undefined);
    throw e;
  }
}

async function performTicks(ctx: ActionContext, sequences: ActionSequence[]): Promise<void> {
  const cursors = sequences.map(() => 0);
  const ticks = Math.max(0, ...sequences.map((s) => s.actions.length));
  for (let tick = 0; tick < ticks; tick++) {
    let pause = 0;
    for (const [i, seq] of sequences.entries()) {
      const a = seq.actions[cursors[i]];
      if (!a) {
        continue;
      }
      if (a.type === 'pause') {
        pause = Math.max(pause, a.duration ?? 0);
      } else {
        cursors[i] += await dispatch(ctx, a, seq.actions.slice(cursors[i] + 1));
      }
      cursors[i]++;
    }
    if (pause) {
      await new Promise((r) => setTimeout(r, pause));
    }
  }
}

async function attempt(failures: unknown[], step: () => Promise<void>): Promise<void> {
  try {
    await step();
  } catch (e) {
    failures.push(e);
  }
}

export async function release(ctx: ActionContext): Promise<void> {
  const failures: unknown[] = [];
  try {
    for (const button of ctx.state.buttons) {
      await attempt(failures, () => ctx.input.mouseUp(button));
    }
    await attempt(failures, () => ctx.platform.releaseKeys(ctx.input, [...ctx.state.keys]));
  } finally {
    ctx.state.buttons.clear();
    ctx.state.keys.clear();
  }
  if (failures.length) {
    throw failures[0];
  }
}
