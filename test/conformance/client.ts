import assert from 'node:assert/strict';

export const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export class WebDriverError extends Error {
  constructor(public code: string, message: string) {
    super(`${code}: ${message}`);
  }
}

/** A plain W3C WebDriver client over fetch. */
export class Session {
  private constructor(private url: string, public id: string) {}

  static async create(url: string, caps: Record<string, unknown>): Promise<Session> {
    const value = await request(url, 'POST', '/session', { capabilities: { alwaysMatch: caps, firstMatch: [{}] } });
    return new Session(url, (value as { sessionId: string }).sessionId);
  }

  call<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    return request(this.url, method, `/session/${this.id}${path}`, body) as Promise<T>;
  }

  async find(using: string, value: string, from?: string): Promise<string> {
    const path = from ? `/element/${from}/element` : '/element';
    return (await this.call<Record<string, string>>('POST', path, { using, value }))[ELEMENT];
  }

  async findAll(using: string, value: string): Promise<string[]> {
    return (await this.call<Array<Record<string, string>>>('POST', '/elements', { using, value })).map((e) => e[ELEMENT]);
  }

  click(el: string): Promise<unknown> {
    return this.call('POST', `/element/${el}/click`, {});
  }

  type(el: string, text: string): Promise<unknown> {
    return this.call('POST', `/element/${el}/value`, { text });
  }

  clear(el: string): Promise<unknown> {
    return this.call('POST', `/element/${el}/clear`, {});
  }

  text(el: string): Promise<string> {
    return this.call('GET', `/element/${el}/text`);
  }

  attribute(el: string, name: string): Promise<string | null> {
    return this.call('GET', `/element/${el}/attribute/${name}`);
  }

  selected(el: string): Promise<boolean> {
    return this.call('GET', `/element/${el}/selected`);
  }

  displayed(el: string): Promise<boolean> {
    return this.call('GET', `/element/${el}/displayed`);
  }

  enabled(el: string): Promise<boolean> {
    return this.call('GET', `/element/${el}/enabled`);
  }

  async active(): Promise<string> {
    return (await this.call<Record<string, string>>('GET', '/element/active'))[ELEMENT];
  }

  rect(el: string): Promise<Rect> {
    return this.call('GET', `/element/${el}/rect`);
  }

  source(): Promise<string> {
    return this.call('GET', '/source');
  }

  execute<T = unknown>(script: string, arg: Record<string, unknown> = {}): Promise<T> {
    return this.call('POST', '/execute/sync', { script, args: [arg] });
  }

  actions(actions: unknown[]): Promise<unknown> {
    return this.call('POST', '/actions', { actions });
  }

  releaseActions(): Promise<unknown> {
    return this.call('DELETE', '/actions');
  }

  activateApp(appId: string): Promise<unknown> {
    return this.call('POST', '/appium/device/activate_app', { appId });
  }

  terminateApp(appId: string): Promise<boolean> {
    return this.call('POST', '/appium/device/terminate_app', { appId });
  }

  async screenshot(el?: string): Promise<Buffer> {
    return Buffer.from(await this.call<string>('GET', el ? `/element/${el}/screenshot` : '/screenshot'), 'base64');
  }

  delete(): Promise<unknown> {
    return request(this.url, 'DELETE', `/session/${this.id}`);
  }
}

async function request(url: string, method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${url}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json() as { value: { error?: string; message?: string } };
  if (!res.ok) {
    throw new WebDriverError(json.value?.error ?? String(res.status), json.value?.message?.split('\n')[0] ?? '');
  }
  return json.value;
}

export function pngSize(png: Buffer): { width: number; height: number } {
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

export async function eventually<T>(read: () => Promise<T>, check: (v: T) => boolean, ms = 3000): Promise<T> {
  const end = Date.now() + ms;
  let v = await read();
  while (!check(v) && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 50));
    v = await read();
  }
  assert.ok(check(v), `still ${JSON.stringify(v)?.slice(0, 200)}`);
  return v;
}

export async function rejectsWith(p: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(p, (e: unknown) => e instanceof WebDriverError && e.code === code);
}
