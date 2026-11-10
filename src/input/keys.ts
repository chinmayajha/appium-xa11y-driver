import { errors } from 'appium/driver';

const W3C_KEYS: Record<string, string> = {
  '': 'Backspace',
  '': 'Tab',
  '': 'Enter',
  '': 'Enter',
  '': 'Shift',
  '': 'Ctrl',
  '': 'Alt',
  '': 'Escape',
  '': 'Space',
  '': 'PageUp',
  '': 'PageDown',
  '': 'End',
  '': 'Home',
  '': 'ArrowLeft',
  '': 'ArrowUp',
  '': 'ArrowRight',
  '': 'ArrowDown',
  '': 'Insert',
  '': 'Delete',
  '': 'Meta',
  '': 'Shift',
  '': 'Ctrl',
  '': 'Alt',
  '': 'Meta',
  '': 'PageUp',
  '': 'PageDown',
  '': 'End',
  '': 'Home',
  '': 'ArrowLeft',
  '': 'ArrowUp',
  '': 'ArrowRight',
  '': 'ArrowDown',
  '': 'Insert',
  '': 'Delete',
};
for (let n = 1; n <= 12; n++) {
  W3C_KEYS[String.fromCharCode(0xe030 + n)] = `F${n}`;
}
// The numpad keys type their characters, because xa11y has no numpad key codes.
[...';=0123456789*+,-./'].forEach((ch, i) => {
  W3C_KEYS[String.fromCharCode(0xe018 + i)] = ch;
});

const NAMES: Record<string, string> = {
  cmd: 'Meta', command: 'Meta', meta: 'Meta', super: 'Meta', win: 'Meta', windows: 'Meta',
  ctrl: 'Ctrl', control: 'Ctrl',
  alt: 'Alt', option: 'Alt', opt: 'Alt',
  shift: 'Shift',
  enter: 'Enter', return: 'Enter',
  esc: 'Escape', escape: 'Escape',
  tab: 'Tab', space: 'Space', backspace: 'Backspace', delete: 'Delete', del: 'Delete', insert: 'Insert',
  up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
  arrowup: 'ArrowUp', arrowdown: 'ArrowDown', arrowleft: 'ArrowLeft', arrowright: 'ArrowRight',
  home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown', plus: '+',
};

export const MODIFIERS = new Set(['Shift', 'Ctrl', 'Alt', 'Meta']);

function isW3cCode(value: string): boolean {
  const code = value.length === 1 ? value.charCodeAt(0) : 0;
  return code > 0xe000 && code <= 0xe05d;
}

export function w3cKey(value: string): string {
  const key = W3C_KEYS[value];
  if (key) {
    return key;
  }
  if (isW3cCode(value)) {
    throw new errors.InvalidArgumentError(`The W3C key U+${value.charCodeAt(0).toString(16).toUpperCase()} has no desktop key`);
  }
  return value;
}

export function isSpecialKey(char: string): boolean {
  return char in W3C_KEYS || isW3cCode(char);
}

function keyName(token: string, primary: string): string {
  if ([...token].length === 1) {
    return w3cKey(token);
  }
  const lower = token.toLowerCase();
  if (lower === 'primary') {
    return primary;
  }
  const fn = /^f([1-9]|1[0-9]|2[0-4])$/.exec(lower);
  const name = NAMES[lower] ?? (fn ? `F${fn[1]}` : undefined);
  if (!name) {
    throw new errors.InvalidArgumentError(`Unknown key '${token}'`);
  }
  return name;
}

export interface Chord {
  key: string;
  held: string[];
}

export function parseChord(chord: string, primary: string): Chord {
  const plusKey = chord.trim() === '+' || chord.endsWith('++');
  const body = plusKey ? chord.replace(/\+\+?$/, '') : chord;
  const tokens = body.split('+').map((t) => t.trim()).filter(Boolean);
  if (plusKey) {
    tokens.push('+');
  }
  if (tokens.length === 0) {
    throw new errors.InvalidArgumentError(`Empty key chord '${chord}'`);
  }
  const names = tokens.map((t) => keyName(t, primary));
  return { key: names[names.length - 1], held: names.slice(0, -1) };
}
