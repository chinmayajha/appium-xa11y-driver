import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { createConnection, type Socket } from 'node:net';
import { Replies, shared } from './replies';

const OP_INTERN_ATOM = 16;
const OP_GET_PROPERTY = 20;
const COOKIE_AUTH = 'MIT-MAGIC-COOKIE-1';
const AUTH_FAMILY_BYTES = 2;
const TIMEOUT_MS = 3000;

export interface Frame {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

const pad = (n: number) => (4 - (n % 4)) % 4;

function displayNumber(display: string): string | undefined {
  return /^(?:unix)?:(\d+)(?:\.\d+)?$/.exec(display)?.[1];
}

function* authEntries(data: Buffer): Generator<Buffer[]> {
  let at = 0;
  const field = () => {
    const len = data.readUInt16BE(at);
    at += 2 + len;
    return data.subarray(at - len, at);
  };
  while (at + 2 <= data.length) {
    at += AUTH_FAMILY_BYTES;
    yield [field(), field(), field(), field()];
  }
}

function readAuthority(): Buffer | undefined {
  try {
    return readFileSync(process.env.XAUTHORITY ?? path.join(homedir(), '.Xauthority'));
  } catch {
    return undefined;
  }
}

const forDisplay = (number: Buffer, display: string) => number.length === 0 || number.toString() === display;

function cookie(display: string): Buffer | undefined {
  const data = readAuthority();
  const entry = data && [...authEntries(data)].find(([, number, name]) => name.toString() === COOKIE_AUTH && forDisplay(number, display));
  return entry?.[3];
}

function setupRequest(secret?: Buffer): Buffer {
  const name = secret ? Buffer.from(COOKIE_AUTH) : Buffer.alloc(0);
  const data = secret ?? Buffer.alloc(0);
  const head = Buffer.alloc(12);
  head.write('l', 0);
  head.writeUInt16LE(11, 2);
  head.writeUInt16LE(name.length, 6);
  head.writeUInt16LE(data.length, 8);
  return Buffer.concat([head, name, Buffer.alloc(pad(name.length)), data, Buffer.alloc(pad(data.length))]);
}

function rootOf(setup: Buffer): number {
  const vendorLength = setup.readUInt16LE(24);
  const formats = setup.readUInt8(29);
  return setup.readUInt32LE(40 + vendorLength + pad(vendorLength) + 8 * formats);
}

/** A minimal X11 client: atoms and window properties, which is all the GTK 4 origin needs. */
class X11 {
  private buffer = Buffer.alloc(0);
  private sequence = 0;
  private replies = new Replies<Buffer>(TIMEOUT_MS);
  private atoms = new Map<string, Promise<number>>();

  private constructor(private socket: Socket, readonly root: number) {
    socket.on('data', (chunk) => this.replies.parse(socket, () => this.receive(chunk)));
    socket.on('error', (e) => this.replies.closed(e));
    socket.on('close', () => this.replies.closed(new Error('The X server closed the connection')));
    socket.unref();
  }

  onClose(handler: () => void): void {
    this.replies.onClose(handler);
  }

  static connect(display: string): Promise<X11> {
    const number = displayNumber(display);
    if (!number) {
      return Promise.reject(new Error(`DISPLAY '${display}' is not a local X11 display`));
    }
    return new Promise((resolve, reject) => {
      const socket = createConnection(`/tmp/.X11-unix/X${number}`);
      let setup = Buffer.alloc(0);
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error('The X server did not answer'));
      }, TIMEOUT_MS);
      const onData = (chunk: Buffer) => {
        setup = Buffer.concat([setup, chunk]);
        if (setup.length < 8 || setup.length < 8 + 4 * setup.readUInt16LE(6)) {
          return;
        }
        clearTimeout(timer);
        socket.off('data', onData);
        if (setup[0] !== 1) {
          socket.destroy();
          reject(new Error(`The X server refused the connection: ${setup.subarray(8, 8 + setup[1]).toString()}`));
          return;
        }
        resolve(new X11(socket, rootOf(setup)));
      };
      socket.on('data', onData);
      socket.once('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      socket.write(setupRequest(cookie(number)));
    });
  }

  private receive(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 32) {
      const size = this.buffer[0] === 1 ? 32 + 4 * this.buffer.readUInt32LE(4) : 32;
      if (this.buffer.length < size) {
        return;
      }
      const packet = this.buffer.subarray(0, size);
      this.buffer = this.buffer.subarray(size);
      if (packet[0] <= 1) {
        this.replies.settle(packet.readUInt16LE(2), packet[0] === 1 ? { value: packet } : { error: new Error(`X11 error ${packet[1]}`) });
      }
    }
  }

  private request(opcode: number, detail: number, body: Buffer): Promise<Buffer> {
    const head = Buffer.alloc(4);
    head.writeUInt8(opcode, 0);
    head.writeUInt8(detail, 1);
    head.writeUInt16LE((4 + body.length) / 4, 2);
    this.sequence = (this.sequence + 1) & 0xffff;
    const reply = this.replies.wait(this.sequence, `X11 request ${opcode}`);
    this.socket.write(Buffer.concat([head, body]));
    return reply;
  }

  atom(name: string): Promise<number> {
    let known = this.atoms.get(name);
    if (!known) {
      const body = Buffer.alloc(4 + name.length + pad(name.length));
      body.writeUInt16LE(name.length, 0);
      body.write(name, 4, 'latin1');
      known = this.request(OP_INTERN_ATOM, 0, body).then((r) => r.readUInt32LE(8), (e) => {
        this.atoms.delete(name);
        throw e;
      });
      this.atoms.set(name, known);
    }
    return known;
  }

  async property(window: number, name: string): Promise<Buffer> {
    const body = Buffer.alloc(20);
    body.writeUInt32LE(window, 0);
    body.writeUInt32LE(await this.atom(name), 4);
    body.writeUInt32LE(1 << 16, 16);
    const reply = await this.request(OP_GET_PROPERTY, 0, body);
    const unit = reply[1] / 8;
    return reply.subarray(32, 32 + unit * reply.readUInt32LE(16));
  }

  async cardinals(window: number, name: string): Promise<number[]> {
    const data = await this.property(window, name);
    return Array.from({ length: data.length / 4 }, (_, i) => data.readUInt32LE(4 * i));
  }
}

const x11 = shared(() => X11.connect(process.env.DISPLAY ?? ''));

/** The client-side shadow around the app's X11 window titled `title`, or undefined unless exactly one window matches. */
export async function frameExtents(pid: number, title: string): Promise<Frame | undefined> {
  const x = await x11();
  const matches: number[] = [];
  for (const w of await x.cardinals(x.root, '_NET_CLIENT_LIST')) {
    const [owner] = await x.cardinals(w, '_NET_WM_PID');
    if (owner === pid && (await x.property(w, '_NET_WM_NAME')).toString('utf8') === title) {
      matches.push(w);
    }
  }
  if (matches.length !== 1) {
    return undefined;
  }
  const [left = 0, right = 0, top = 0, bottom = 0] = await x.cardinals(matches[0], '_GTK_FRAME_EXTENTS');
  return { left, right, top, bottom };
}
