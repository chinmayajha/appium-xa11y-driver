import { Bus, type Reader } from './dbus';
import { shared } from './replies';

const ROOT_PATH = '/org/a11y/atspi/accessible/root';

const gtk4Apps = new Map<string, Promise<boolean | undefined>>();

async function atspiAddress(): Promise<string> {
  if (process.env.AT_SPI_BUS_ADDRESS) {
    return process.env.AT_SPI_BUS_ADDRESS;
  }
  const session = await Bus.connect(process.env.DBUS_SESSION_BUS_ADDRESS ?? '');
  try {
    return (await session.call('org.a11y.Bus', '/org/a11y/bus', 'org.a11y.Bus', 'GetAddress')).str();
  } finally {
    session.close();
  }
}

const atspi = shared(() => atspiAddress().then(Bus.connect));

function variantString(r: Reader): string {
  r.sig();
  return r.str();
}

async function property(dest: string, iface: string, name: string): Promise<string> {
  const reply = await (await atspi()).call(dest, ROOT_PATH, 'org.freedesktop.DBus.Properties', 'Get', [{ s: iface }, { s: name }]);
  return variantString(reply);
}

/** Whether the element's app uses GTK 4, which reports no screen positions on X11; undefined when the app does not answer. */
export function isGtk4(busName: string): Promise<boolean | undefined> {
  let known = gtk4Apps.get(busName);
  if (!known) {
    known = Promise.all([
      property(busName, 'org.a11y.atspi.Application', 'ToolkitName'),
      property(busName, 'org.a11y.atspi.Application', 'Version'),
    ]).then(([name, version]) => name === 'GTK' && version.startsWith('4.'), () => {
      gtk4Apps.delete(busName);
      return undefined;
    });
    gtk4Apps.set(busName, known);
  }
  return known;
}
