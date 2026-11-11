import { screenshot, type Rect, type Screenshot } from '@crowecawcaw/xa11y';
import { errors } from 'appium/driver';
import { HostError } from './errors';

function desktopRect(shot: Screenshot): Rect {
  const [x0, y0] = shot.imageToDesktop(0, 0);
  const [x1] = shot.imageToDesktop(shot.width - 1, shot.height - 1);
  const scale = shot.width > 1 ? (x1 - x0) / (shot.width - 1) : 1;
  return { x: Math.round(x0), y: Math.round(y0), width: Math.round(shot.width * scale), height: Math.round(shot.height * scale) };
}

// A capture costs tens of milliseconds and the size rarely changes, so pointer sequences close together share one.
const DESKTOP_TTL_MS = 2000;

const CAPTURE_TIMEOUT_MS = 10000;
// A capture that never returns holds a Node.js worker thread, so later captures wait on it instead of taking another thread.
let inflight: { at: number; shot: Promise<Screenshot> } | undefined;

function stuck(): HostError {
  return new HostError(`The screen capture did not return in ${CAPTURE_TIMEOUT_MS / 1000} s. A different process can hold a capture (docs/xa11y-gaps.md item 13): stop that process. If captures still fail, restart Appium`);
}

async function capture(): Promise<Screenshot> {
  const job = (inflight ??= { at: Date.now(), shot: screenshot().finally(() => {
    inflight = undefined;
  }) });
  const left = job.at + CAPTURE_TIMEOUT_MS - Date.now();
  if (left <= 0) {
    throw stuck();
  }
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(stuck()), left);
  });
  try {
    return await Promise.race([job.shot, late]);
  } finally {
    clearTimeout(timer);
  }
}

function sized(shot: Screenshot, width: number, height: number): Screenshot {
  return width === shot.width && height === shot.height ? shot : shot.resize(width, height);
}

/** Screenshots in Desktop coordinates: one image pixel per point. */
export class Screen {
  private known?: { at: number; rect: Rect };

  /** The whole desktop, or the part under a rect. Parts are cut from one full capture. */
  async capture(rect?: Rect): Promise<Buffer> {
    const full = await capture();
    if (!rect) {
      const d = this.remember(desktopRect(full));
      return sized(full, d.width, d.height).toPng();
    }
    const [part] = full.desktopRectToImage(rect);
    if (!part || part.width < 1 || part.height < 1) {
      throw new errors.InvalidElementStateError('The element is not on the screen');
    }
    const d = this.remember(desktopRect(full));
    const w = Math.min(rect.x + rect.width, d.x + d.width) - Math.max(rect.x, d.x);
    const h = Math.min(rect.y + rect.height, d.y + d.height) - Math.max(rect.y, d.y);
    return sized(full.crop(part), Math.max(1, Math.round(w)), Math.max(1, Math.round(h))).toPng();
  }

  async desktop(): Promise<Rect> {
    if (this.known && Date.now() - this.known.at < DESKTOP_TTL_MS) {
      return this.known.rect;
    }
    return this.remember(desktopRect(await capture()));
  }

  private remember(rect: Rect): Rect {
    this.known = { at: Date.now(), rect };
    return rect;
  }
}
