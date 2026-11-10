import { screenshot, type Rect, type Screenshot } from '@crowecawcaw/xa11y';
import { errors } from 'appium/driver';

function desktopRect(shot: Screenshot): Rect {
  const [x0, y0] = shot.imageToDesktop(0, 0);
  const [x1] = shot.imageToDesktop(shot.width - 1, shot.height - 1);
  const scale = shot.width > 1 ? (x1 - x0) / (shot.width - 1) : 1;
  return { x: Math.round(x0), y: Math.round(y0), width: Math.round(shot.width * scale), height: Math.round(shot.height * scale) };
}

function sized(shot: Screenshot, width: number, height: number): Screenshot {
  return width === shot.width && height === shot.height ? shot : shot.resize(width, height);
}

/** Screenshots in Desktop coordinates: one image pixel per point. */
export class Screen {
  /** The whole desktop, or the part under a rect. Parts are cut from one full capture. */
  async capture(rect?: Rect): Promise<Buffer> {
    const full = await screenshot();
    if (!rect) {
      const d = desktopRect(full);
      return sized(full, d.width, d.height).toPng();
    }
    const [part] = full.desktopRectToImage(rect);
    if (!part || part.width < 1 || part.height < 1) {
      throw new errors.InvalidElementStateError('The element is not on the screen');
    }
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    return sized(full.crop(part), w, h).toPng();
  }

  async desktop(): Promise<Rect> {
    return desktopRect(await screenshot());
  }
}
