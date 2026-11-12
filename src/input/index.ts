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
    const el = await this.tree.element(id);
    if (el.actions.includes('press')) {
      await el.press();
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
    const el = id === undefined ? undefined : await this.focus(id);
    let viaValue = this.platform.typeTextMovesCaret && Boolean(el && (el.editable || el.actions.includes('set_value')));
    let run = '';
    for (const ch of [...text].map(typedChar)) {
      const key = keyFor(ch, viaValue);
      if (!key) {
        run += ch;
        continue;
      }
      await this.typeRun(run, viaValue ? el : undefined, id);
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

  /** Types the run through the element's value, or as Raw input when there is no element, it refuses, or its value stays the same. */
  private async typeRun(run: string, el?: Element, id?: string): Promise<void> {
    if (!run || (el && id !== undefined && await this.typedByValue(run, el, id))) {
      return;
    }
    await this.guard();
    await this.sim.typeText(run);
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

  private async guard(always = false): Promise<void> {
    if (!always && Date.now() - this.checkedAt < GUARD_INTERVAL_MS) {
      return;
    }
    const app = this.target.app;
    if (!(await this.platform.isFrontmost(app))) {
      const front = await this.platform.frontmostName().catch(() => undefined);
      throw new errors.InvalidElementStateError(
        `${app.name} is not the frontmost app (${front ?? 'another window'} is), so keyboard and mouse input would reach that app. `
        + 'Activate it first (activateApp or xa11y: focusWindow).',
      );
    }
    this.checkedAt = Date.now();
  }
}

export type { ActionSequence };
