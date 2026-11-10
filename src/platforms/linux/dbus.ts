import net from 'node:net';
import { Replies } from './replies';

type Arg = { u: number } | { s: string };

const CALL_TIMEOUT_MS = 3000;
const LITTLE_ENDIAN = 0x6c;

class Writer {
  private bytes: number[] = [];

  get length(): number {
    return this.bytes.length;
  }

  align(n: number): void {
    while (this.bytes.length % n) {
      this.bytes.push(0);
    }
  }

  u8(v: number): void {
    this.bytes.push(v & 0xff);
  }

  u32(v: number, at?: number): void {
    const b = [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
    if (at === undefined) {
      this.align(4);
      this.bytes.push(...b);
    } else {
      this.bytes.splice(at, 4, ...b);
    }
  }

  str(v: string): void {
    const b = Buffer.from(v, 'utf8');
    this.u32(b.length);
    this.bytes.push(...b, 0);
  }

  sig(v: string): void {
    this.u8(v.length);
    this.bytes.push(...Buffer.from(v, 'ascii'), 0);
  }

  buffer(): Buffer {
    return Buffer.from(this.bytes);
  }
}

export class Reader {
  constructor(private buf: Buffer, private pos = 0, private base = 0) {}

  private align(n: number): void {
    this.pos += (n - ((this.pos - this.base) % n)) % n;
  }

  get offset(): number {
    return this.pos;
  }

  u8(): number {
    return this.buf[this.pos++];
  }

  i32(): number {
    this.align(4);
    const v = this.buf.readInt32LE(this.pos);
    this.pos += 4;
    return v;
  }

  str(): string {
    const len = this.i32();
    const v = this.buf.toString('utf8', this.pos, this.pos + len);
    this.pos += len + 1;
    return v;
  }

  sig(): string {
    const len = this.buf[this.pos];
    const v = this.buf.toString('ascii', this.pos + 1, this.pos + 1 + len);
    this.pos += len + 2;
    return v;
  }

  struct(): void {
    this.align(8);
  }
}

function socketPath(address: string): string {
  const m = /(?:^|;)unix:(?:[^;]*,)?(path|abstract)=([^,;]+)/.exec(address);
  if (!m) {
    throw new Error(`No unix socket in D-Bus address '${address}'`);
  }
  return (m[1] === 'abstract' ? '\0' : '') + decodeURIComponent(m[2]);
}

function headerField(w: Writer, code: number, type: string, value: string): void {
  w.align(8);
  w.u8(code);
  w.sig(type);
  if (type === 'g') {
    w.sig(value);
  } else {
    w.str(value);
  }
}

function message(serial: number, dest: string, path: string, iface: string, member: string, args: Arg[]): Buffer {
  const signature = args.map((a) => ('u' in a ? 'u' : 's')).join('');
  const body = new Writer();
  for (const a of args) {
    if ('u' in a) {
      body.u32(a.u);
    } else {
      body.str(a.s);
    }
  }
  const w = new Writer();
  w.u8('l'.charCodeAt(0));
  w.u8(1);
  w.u8(0);
  w.u8(1);
  w.u32(body.length);
  w.u32(serial);
  w.u32(0);
  const fieldsStart = w.length;
  headerField(w, 1, 'o', path);
  headerField(w, 2, 's', iface);
  headerField(w, 3, 's', member);
  headerField(w, 6, 's', dest);
  if (signature) {
    headerField(w, 8, 'g', signature);
  }
  w.u32(w.length - fieldsStart, 12);
  w.align(8);
  return Buffer.concat([w.buffer(), body.buffer()]);
}

function authenticate(socket: net.Socket): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    socket.once('error', reject);
    socket.once('connect', () => {
      const uid = Buffer.from(String(process.getuid?.() ?? 0)).toString('hex');
      socket.write(`\0AUTH EXTERNAL ${uid}\r\n`);
    });
    socket.once('data', (d) => {
      if (!d.toString().startsWith('OK')) {
        reject(new Error(`D-Bus authentication failed: ${d.toString().trim()}`));
        return;
      }
      socket.off('error', reject);
      socket.write('BEGIN\r\n');
      resolve();
    });
  });
}

/** A minimal D-Bus connection: method calls with u and s arguments, pipelined on one socket. */
export class Bus {
  private serial = 0;
  private replies = new Replies<Reader>(CALL_TIMEOUT_MS);
  private data = Buffer.alloc(0);

  private constructor(private socket: net.Socket) {
    socket.on('data', (chunk) => this.replies.parse(socket, () => this.receive(chunk)));
    socket.on('close', () => this.replies.closed(new Error('D-Bus connection closed')));
    socket.on('error', (e) => this.replies.closed(e));
  }

  onClose(handler: () => void): void {
    this.replies.onClose(handler);
  }

  static async connect(address: string): Promise<Bus> {
    const socket = net.createConnection(socketPath(address));
    socket.unref();
    const timer = setTimeout(() => socket.destroy(new Error('The D-Bus handshake timed out')), CALL_TIMEOUT_MS);
    try {
      await authenticate(socket);
      const bus = new Bus(socket);
      await bus.call('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'Hello');
      return bus;
    } catch (e) {
      socket.destroy();
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  close(): void {
    this.socket.end();
  }

  call(dest: string, path: string, iface: string, member: string, args: Arg[] = []): Promise<Reader> {
    const serial = ++this.serial;
    const reply = this.replies.wait(serial, `D-Bus call ${iface}.${member}`);
    this.socket.write(message(serial, dest, path, iface, member, args));
    return reply;
  }

  private receive(chunk: Buffer): void {
    this.data = Buffer.concat([this.data, chunk]);
    while (this.data.length >= 16) {
      if (this.data[0] !== LITTLE_ENDIAN) {
        throw new Error('The D-Bus message is not little-endian');
      }
      const fieldsLen = this.data.readUInt32LE(12);
      const headerEnd = 16 + fieldsLen + ((8 - ((16 + fieldsLen) % 8)) % 8);
      const total = headerEnd + this.data.readUInt32LE(4);
      if (this.data.length < total) {
        return;
      }
      const msg = this.data.subarray(0, total);
      this.data = this.data.subarray(total);
      this.dispatch(msg, msg[1], fieldsLen, headerEnd);
    }
  }

  private dispatch(msg: Buffer, type: number, fieldsLen: number, headerEnd: number): void {
    const fields = new Reader(msg, 16);
    let replyTo = 0;
    let error = '';
    while (fields.offset < 16 + fieldsLen) {
      fields.struct();
      const code = fields.u8();
      const sig = fields.sig();
      const value = sig === 'u' ? fields.i32() : sig === 'g' ? fields.sig() : fields.str();
      replyTo = code === 5 ? Number(value) : replyTo;
      error = code === 4 ? String(value) : error;
    }
    const body = new Reader(msg, headerEnd, headerEnd);
    if (type === 2) {
      this.replies.settle(replyTo, { value: body });
    } else if (type === 3) {
      this.replies.settle(replyTo, { error: new Error(`${error}: ${msg.length > headerEnd ? body.str() : ''}`) });
    }
  }
}
