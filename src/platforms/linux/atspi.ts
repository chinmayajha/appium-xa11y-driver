import type { Element, Rect } from '@crowecawcaw/xa11y';
import { Bus, type Reader } from './dbus';

const COORD_WINDOW = 1;
const ROOT_PATH = '/org/a11y/atspi/accessible/root';

let bus: Promise<Bus> | undefined;
const gtk4Apps = new Map<string, Promise<boolean>>();

async function atspiAddress(): Promise<string> {
  if (process.env.AT_SPI_BUS_ADDRESS) {
    return process.env.AT_SPI_BUS_ADDRESS;
  }
  const session = await Bus.connect(process.env.DBUS_SESSION_BUS_ADDRESS ?? '');
  return (await session.call('org.a11y.Bus', '/org/a11y/bus', 'org.a11y.Bus', 'GetAddress')).str();
}

function atspi(): Promise<Bus> {
  bus ??= atspiAddress().then(Bus.connect).catch((e) => {
    bus = undefined;
    throw e;
  });
  return bus;
}

function variantString(r: Reader): string {
  r.sig();
  return r.str();
}

async function property(dest: string, iface: string, name: string): Promise<string> {
  const reply = await (await atspi()).call(dest, ROOT_PATH, 'org.freedesktop.DBus.Properties', 'Get', [{ s: iface }, { s: name }]);
  return variantString(reply);
}

/** Whether the element's app uses GTK 4, which reports no screen positions on X11. */
export function isGtk4(busName: string): Promise<boolean> {
  let known = gtk4Apps.get(busName);
  if (!known) {
    known = Promise.all([
      property(busName, 'org.a11y.atspi.Application', 'ToolkitName'),
      property(busName, 'org.a11y.atspi.Application', 'Version'),
    ]).then(([name, version]) => name === 'GTK' && version.startsWith('4.'), () => false);
    gtk4Apps.set(busName, known);
  }
  return known;
}

/** Extents relative to the element's top-level window. */
export async function windowExtents(el: Element): Promise<Rect> {
  const reply = await (await atspi()).call(
    String(el.raw.bus_name), String(el.raw.object_path), 'org.a11y.atspi.Component', 'GetExtents', [{ u: COORD_WINDOW }],
  );
  reply.struct();
  return { x: reply.i32(), y: reply.i32(), width: reply.i32(), height: reply.i32() };
}
