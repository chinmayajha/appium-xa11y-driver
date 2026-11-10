import type { InputSim, MouseButtonName } from '@crowecawcaw/xa11y';
import { errors } from 'appium/driver';
import { MODIFIERS, w3cKey } from './keys';
import type { Platform, Point } from './platforms';

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
  buttons: Set<MouseButtonName>;
  keys: Set<string>;
}

export interface ActionContext {
  platform: Platform;
  input: InputSim;
  state: InputState;
  elementCenter: (elementId: string) => Promise<Point>;
}

const BUTTONS: MouseButtonName[] = ['left', 'middle', 'right'];

export function newInputState(): InputState {
  return { pointer: { x: 0, y: 0 }, buttons: new Set(), keys: new Set() };
}

function heldModifiers(state: InputState): string[] {
  return [...state.keys].filter((k) => MODIFIERS.has(k));
}

async function resolvePoint(ctx: ActionContext, a: Action): Promise<Point> {
  const x = a.x ?? 0;
  const y = a.y ?? 0;
  const origin = a.origin ?? 'viewport';
  if (origin === 'viewport') {
    return { x, y };
  }
  if (origin === 'pointer') {
    return { x: ctx.state.pointer.x + x, y: ctx.state.pointer.y + y };
  }
  const id = typeof origin === 'object' ? Object.values(origin)[0] : undefined;
  if (!id) {
    throw new errors.InvalidArgumentError(`Unknown pointer origin ${JSON.stringify(origin)}`);
  }
  const c = await ctx.elementCenter(id);
  return { x: c.x + x, y: c.y + y };
}

function buttonOf(a: Action): MouseButtonName {
  return BUTTONS[a.button ?? 0] ?? 'left';
}

function pairedPointerUp(a: Action, next: Action | undefined): boolean {
  return next?.type === 'pointerUp' && buttonOf(next) === buttonOf(a);
}

function pairedKeyUp(key: string, next: Action | undefined): boolean {
  return !MODIFIERS.has(key) && next?.type === 'keyUp' && w3cKey(next.value ?? '') === key;
}

type Handler = (ctx: ActionContext, a: Action, next?: Action) => Promise<boolean>;

const ACTIONS: Record<string, Handler> = {
  async pointerMove(ctx, a) {
    ctx.state.pointer = await resolvePoint(ctx, a);
    await ctx.input.moveTo([ctx.state.pointer.x, ctx.state.pointer.y]);
    return false;
  },
  async pointerDown(ctx, a, next) {
    const button = buttonOf(a);
    if (pairedPointerUp(a, next)) {
      await ctx.input.click([ctx.state.pointer.x, ctx.state.pointer.y], { button, held: heldModifiers(ctx.state) });
      return true;
    }
    ctx.state.buttons.add(button);
    await ctx.input.mouseDown(button);
    return false;
  },
  async pointerUp(ctx, a) {
    ctx.state.buttons.delete(buttonOf(a));
    await ctx.input.mouseUp(buttonOf(a));
    return false;
  },
  async keyDown(ctx, a, next) {
    const key = w3cKey(a.value ?? '');
    if (pairedKeyUp(key, next)) {
      await ctx.input.press(key);
      return true;
    }
    ctx.state.keys.add(key);
    await ctx.input.keyDown(key);
    return false;
  },
  async keyUp(ctx, a) {
    const key = w3cKey(a.value ?? '');
    ctx.state.keys.delete(key);
    await ctx.platform.releaseKeys(ctx.input, [key]);
    return false;
  },
  async scroll(ctx, a) {
    await ctx.platform.wheel(ctx.input, await resolvePoint(ctx, a), a.deltaX ?? 0, a.deltaY ?? 0);
    return false;
  },
};

// xa11y's chord does not wait for its modifier release, so a key sent right after it can still carry the modifiers.
export async function pressChord(platform: Platform, input: InputSim, key: string, held: string[]): Promise<void> {
  for (const m of held) {
    await input.keyDown(m);
  }
  try {
    await input.press(key);
  } finally {
    await platform.releaseKeys(input, [...held].reverse());
  }
}

export async function perform(ctx: ActionContext, sequences: ActionSequence[]): Promise<void> {
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
      } else if (await ACTIONS[a.type]?.(ctx, a, seq.actions[cursors[i] + 1])) {
        cursors[i]++;
      }
      cursors[i]++;
    }
    if (pause) {
      await new Promise((r) => setTimeout(r, pause));
    }
  }
}

export async function release(ctx: ActionContext): Promise<void> {
  for (const button of ctx.state.buttons) {
    await ctx.input.mouseUp(button);
  }
  await ctx.platform.releaseKeys(ctx.input, [...ctx.state.keys]);
  ctx.state.buttons.clear();
  ctx.state.keys.clear();
}
