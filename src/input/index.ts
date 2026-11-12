import { inputSim, type Element, type Rect } from '@crowecawcaw/xa11y';
import { errors } from 'appium/driver';
import type { Platform } from '../platforms';
import type { Screen } from '../screen';
import type { Target } from '../target';
import type { Tree } from '../tree';
import { newInputState, perform, pressChord, release, type ActionContext, type ActionSequence } from './actions';
import { isSpecialKey, parseChord, w3cKey } from './keys';

// Raw keyboard input on Linux cannot type control characters, so they are sent as the keys that make them.
const CONTROL_KEYS: Record<string, string> = { '\n': 'Enter', '\r': 'Enter', '\t': 'Tab' };
// A check costs a round trip to the accessibility API, so events closer together than this share one.
const GUARD_INTERVAL_MS = 100;
// An app can show a value it was given a moment later, so the value is read again before the text goes as Raw input.
const VALUE_SETTLE_MS = [0, 150];
const FRONT_WAIT_MS = [50, 150, 300];
const MULTILINE_ROLES = new Set(['text_area', 'web_area']);
// An app that just came to the front drops the first click while it activates its window (Spotify's Create menu).
const ACTIVATED_SETTLE_MS = 250;
// An app reads a value set through accessibility after a Raw key sent at once (Calendar's quick event drops the Return).
const KEY_AFTER_VALUE_MS = 300;

/** A W3C key code that stands for a character, such as the numpad keys, becomes that character. */
function typedChar(ch: string): string {
  const key = isSpecialKey(ch) ? w3cKey(ch) : ch;
  return [...key].length === 1 ? key : ch;
}

function keyFor(ch: string, viaValue: boolean): string | undefined {
  if (isSpecialKey(ch)) {
    return w3cKey(ch);
  }
  return viaValue ? undefined : CONTROL_KEYS[ch];
}

/** Accessibility actions first, Raw input second, and Raw input only while the Session app is frontmost. */
export class Input {
  private sim = inputSim();
  private state = newInputState();
  private checkedAt = 0;

  constructor(private target: Target, private tree: Tree, private platform: Platform, private screen: Screen) {}

  async click(id: string): Promise<void> {
    await this.front();
    const el = await this.tree.element(id);
    // Some elements list press and refuse it (a text field in Calendar).
    if (el.actions.includes('press') && await el.press().then(() => true, () => false)) {
      return;
    }
    await this.rawClick(id);
  }

  private async rawClick(id: string): Promise<void> {
    const at = await this.tree.visibleCenter(id);
    await this.guard(true);
    this.state.synced = false;
    await this.sim.click([at.x, at.y]);
  }

  /** Put text into the element, or type it into the Frontmost app when no element is given. */
  async type(text: string, id?: string): Promise<void> {
    await this.front();
    const el = id === undefined ? undefined : await this.focus(id);
    let viaValue = this.platform.typeTextMovesCaret && Boolean(el && (el.editable || el.actions.includes('set_value')));
    // A single-line field drops a line break from its value, so Return and Tab go to it as keys.
    const singleLine = el !== undefined && !MULTILINE_ROLES.has(el.role);
    let run = '';
    for (const ch of [...text].map(typedChar)) {
      const key = keyFor(ch, viaValue && !singleLine);
      if (!key) {
        run += ch;
        continue;
      }
      if (await this.typeRun(run, viaValue ? el : undefined, id)) {
        await new Promise((r) => setTimeout(r, KEY_AFTER_VALUE_MS));
      }
      // The app gets Raw input after accessibility calls that come later, so the text after a Raw key stays Raw to keep its order.
      viaValue = false;
      run = '';
      await this.guard();
      await this.platform.pressKey(this.sim, key);
    }
    await this.typeRun(run, viaValue ? el : undefined, id);
  }

  private async focus(id: string): Promise<Element> {
    const el = await this.tree.element(id);
    await el.focus().catch(() => this.rawClick(id));
    return el;
  }

  /** Types the run through the element's value, or as Raw input when there is no element, it refuses, or its value stays the same; true when the value took it. */
  private async typeRun(run: string, el?: Element, id?: string): Promise<boolean> {
    if (!run) {
      return false;
    }
    if (el && id !== undefined && await this.typedByValue(run, el, id)) {
      return true;
    }
    await this.guard();
    await this.sim.typeText(run);
    return false;
  }

  // Some apps (Mac Catalyst apps such as WhatsApp) accept the accessibility call and ignore it.
  private async typedByValue(run: string, el: Element, id: string): Promise<boolean> {
    const before = el.value ?? '';
    if (!(await el.typeText(run).then(() => true, () => false))) {
      return false;
    }
    for (const wait of VALUE_SETTLE_MS) {
      await new Promise((r) => setTimeout(r, wait));
      const after = await this.tree.element(id).then((e) => e.value ?? '', () => undefined);
      if (after !== before) {
        return true;
      }
    }
    return false;
  }

  async clear(id: string): Promise<void> {
    await (await this.tree.element(id)).setValue('');
  }

  async chord(keys: string): Promise<void> {
    const chord = parseChord(keys, this.platform.primaryModifier);
    await this.guard(true);
    await pressChord(this.platform, this.sim, chord.key, chord.held);
  }

  async perform(actions: ActionSequence[]): Promise<void> {
    // A call that only releases keys or buttons must go through (ADR 0002), so the first press checks afresh instead.
    this.checkedAt = 0;
    await perform(this.context(), actions);
  }

  async release(): Promise<void> {
    await release(this.context());
  }

  private context(): ActionContext {
    let screens: Promise<Rect[]> | undefined;
    return {
      platform: this.platform,
      input: this.sim,
      state: this.state,
      guard: () => this.guard(),
      elementCenter: (id) => this.tree.visibleCenter(id),
      screens: () => (screens ??= this.platform.screens?.() ?? this.screen.desktop().then((d) => [d])),
    };
  }

  /** Brings the Session app back to the front when another app took it, so its menus and popovers open; best effort. */
  private async front(): Promise<boolean> {
    const app = this.target.app;
    if (await this.platform.isFrontmost(app)) {
      return true;
    }
    await this.platform.activate(app).catch(() => undefined);
    for (const wait of FRONT_WAIT_MS) {
      await new Promise((r) => setTimeout(r, wait));
      if (await this.platform.isFrontmost(app)) {
        await new Promise((r) => setTimeout(r, ACTIVATED_SETTLE_MS));
        return true;
      }
    }
    return false;
  }

  private async guard(always = false): Promise<void> {
    if (!always && Date.now() - this.checkedAt < GUARD_INTERVAL_MS) {
      return;
    }
    const app = this.target.app;
    if (!(await this.front())) {
      const front = await this.platform.frontmostName().catch(() => undefined);
      throw new errors.InvalidElementStateError(
        `${app.name} did not come to the front (${front ?? 'another window'} stays frontmost, for example a system alert), `
        + 'so keyboard and mouse input would reach that app. Close what holds the front, then try again.',
      );
    }
    this.checkedAt = Date.now();
  }
}

export type { ActionSequence };
