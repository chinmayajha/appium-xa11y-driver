import type { InputSim, MouseButtonName } from '@crowecawcaw/xa11y';
import { errors } from 'appium/driver';
import { MODIFIERS, w3cKey } from './keys';

export interface Point {
  x: number;
  y: number;
}

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
  input: InputSim;
  state: InputState;
  elementCenter: (elementId: string) => Promise<Point>;
}

const BUTTONS: MouseButtonName[] = ['left', 'middle', 'right'];
const WHEEL_PIXELS_PER_LINE = 20;

export function newInputState(): InputState {
  return { pointer: { x: 0, y: 0 }, buttons: new Set(), keys: new Set() };
}

function heldModifiers(state: InputState): string[] {
  return [...state.keys].filter((k) => MODIFIERS.has(k));
}

function wheelLines(pixels: number): number {
  return pixels ? Math.sign(pixels) * Math.max(1, Math.round(Math.abs(pixels) / WHEEL_PIXELS_PER_LINE)) : 0;
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

async function pointerAction(ctx: ActionContext, a: Action, next: Action | undefined): Promise<boolean> {
  const button = BUTTONS[a.button ?? 0] ?? 'left';
  if (a.type === 'pointerMove') {
    ctx.state.pointer = await resolvePoint(ctx, a);
    await ctx.input.moveTo([ctx.state.pointer.x, ctx.state.pointer.y]);
    return false;
  }
  if (a.type === 'pointerDown' && next?.type === 'pointerUp' && (next.button ?? 0) === (a.button ?? 0)) {
    await ctx.input.click([ctx.state.pointer.x, ctx.state.pointer.y], { button, held: heldModifiers(ctx.state) });
    return true;
  }
  if (a.type === 'pointerDown') {
    ctx.state.buttons.add(button);
    await ctx.input.mouseDown(button);
  } else if (a.type === 'pointerUp') {
    ctx.state.buttons.delete(button);
    await ctx.input.mouseUp(button);
  }
  return false;
}

async function keyAction(ctx: ActionContext, a: Action, next: Action | undefined): Promise<boolean> {
  const key = w3cKey(a.value ?? '');
  if (a.type === 'keyDown' && !MODIFIERS.has(key) && next?.type === 'keyUp' && w3cKey(next.value ?? '') === key) {
    const held = heldModifiers(ctx.state);
    await (held.length ? ctx.input.chord(key, held) : ctx.input.press(key));
    return true;
  }
  if (a.type === 'keyDown') {
    ctx.state.keys.add(key);
    await ctx.input.keyDown(key);
  } else if (a.type === 'keyUp') {
    ctx.state.keys.delete(key);
    await ctx.input.keyUp(key);
  }
  return false;
}

async function wheelAction(ctx: ActionContext, a: Action): Promise<boolean> {
  if (a.type === 'scroll') {
    const at = await resolvePoint(ctx, a);
    await ctx.input.scroll([at.x, at.y], wheelLines(a.deltaX ?? 0), wheelLines(a.deltaY ?? 0));
  }
  return false;
}

const HANDLERS: Record<ActionSequence['type'], (ctx: ActionContext, a: Action, next?: Action) => Promise<boolean>> = {
  pointer: pointerAction,
  key: keyAction,
  wheel: wheelAction,
  none: async () => false,
};

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
      } else if (await HANDLERS[seq.type](ctx, a, seq.actions[cursors[i] + 1])) {
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
  for (const key of ctx.state.keys) {
    await ctx.input.keyUp(key);
  }
  ctx.state.buttons.clear();
  ctx.state.keys.clear();
}
