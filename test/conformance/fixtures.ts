/** The fixture apps of each Host OS: built-in apps whose trees the suite knows. */
export interface Fixtures {
  platformName: string;
  primary: string;
  editor: { app: string; field: string; roles: string[]; lineStart: string; siblingBefore?: string };
  calculator: {
    app: string;
    buttons: Record<'C' | '7' | '5' | '+' | '=', string>;
    stableId?: { id: string; name: string };
  };
  /** Arguments that make the app show `shows` when it starts. */
  arguments?: { app: string; args: string[]; shows: string };
  checkBox?: { app: string; xpath: string };
}

const fixtures: Record<string, Fixtures> = {
  mac: {
    platformName: 'Mac',
    primary: '',
    editor: { app: 'com.apple.TextEdit', field: '//text_area', roles: ['text_area'], lineStart: 'primary+left', siblingBefore: 'primary+ctrl+r' },
    calculator: {
      app: 'com.apple.calculator',
      buttons: { C: "//button[@id='AllClear' or @id='Clear']", 7: "//button[@id='Seven']", 5: "//button[@id='Five']", '+': "//button[@id='Add']", '=': "//button[@id='Equals']" },
      stableId: { id: 'Seven', name: '7' },
    },
    checkBox: { app: 'com.apple.TextEdit', xpath: "//check_box[@name='bold']" },
  },
  linux: {
    platformName: 'Linux',
    primary: '',
    editor: { app: 'mousepad', field: '//text_area', roles: ['text_area'], lineStart: 'Home' },
    calculator: {
      app: 'gnome-calculator',
      buttons: { C: "//button[@name='C']", 7: "//button[@name='7']", 5: "//button[@name='5']", '+': "//button[@name='+']", '=': "//button[@name='=']" },
    },
    arguments: { app: 'gnome-calculator', args: ['--equation=40+2'], shows: '40+2' },
    checkBox: { app: 'gtk3-widget-factory', xpath: "(//check_box[@checked='false' and @enabled='true' and @visible='true'])[last()]" },
  },
  windows: {
    platformName: 'Windows',
    primary: '',
    editor: { app: 'notepad.exe', field: '//web_area', roles: ['web_area'], lineStart: 'Home' },
    calculator: {
      app: 'calc.exe',
      buttons: { C: "//button[@id='81']", 7: "//button[@id='137']", 5: "//button[@id='135']", '+': "//button[@id='93']", '=': "//button[@id='121']" },
      stableId: { id: '137', name: '7' },
    },
    arguments: { app: 'notepad.exe', args: ['C:\\Windows\\System32\\drivers\\etc\\hosts'], shows: 'hosts - Notepad' },
  },
};

export function fixturesFor(os: string): Fixtures {
  const f = fixtures[os];
  if (!f) {
    throw new Error(`No fixture apps for '${os}'. Use one of: ${Object.keys(fixtures).join(', ')}`);
  }
  return f;
}
