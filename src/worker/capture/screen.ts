/**
 * Screen capture: GDI BitBlt into a top-down 32bpp DIB section, then sharp
 * for LANCZOS scaling and JPEG q0.75 encoding.
 *
 * This is exactly the path Python `mss` takes on Windows (mss.windows.py:
 * CreateCompatibleDC → CreateCompatibleBitmap → BitBlt(SRCCOPY|CAPTUREBLT) →
 * GetDIBits), so pixel semantics match cc-haha 1:1. CAPTUREBLT catches
 * layered windows that plain SRCCOPY misses. Known limitation: DRM /
 * hardware-overlay / exclusive-fullscreen content captures black — that is
 * reported as capture_failed, not papered over (plan §14 risk 3).
 */

import * as koffi from 'koffi';
import sharp from 'sharp';

import type { ScreenshotResult } from '../../core/types.js';
import {
  BI_RGB,
  BitBlt,
  CAPTUREBLT,
  CreateCompatibleDC,
  CreateDCW,
  CreateDIBSection,
  DIB_RGB_COLORS,
  DeleteDC,
  DeleteObject,
  SelectObject,
  SRCCOPY,
} from '../win32/lib.js';
import { BITMAPINFO } from '../win32/structs.js';
import { listDisplays, chooseDisplay } from '../win32/dpi.js';

interface CaptureRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Width/height of the image-budget target, when the caller wants one. */
export interface CaptureOptions {
  targetWidth?: number;
  targetHeight?: number;
}

function captureRaw(rect: CaptureRect): {
  pixels: Buffer;
  width: number;
  height: number;
} {
  if (rect.width <= 0 || rect.height <= 0) {
    throw new Error(`invalid capture rect: ${rect.width}x${rect.height}`);
  }
  const hdcScreen = CreateDCW('DISPLAY', null, null, null);
  if (!hdcScreen) throw new Error('CreateDCW(DISPLAY) failed');
  try {
    const hdcMem = CreateCompatibleDC(hdcScreen);
    if (!hdcMem) throw new Error('CreateCompatibleDC failed');
    try {
      const bmiPtr = koffi.alloc(BITMAPINFO, 1);
      let hDib: bigint | null = null;
      try {
        koffi.encode(bmiPtr, BITMAPINFO, {
          bmiHeader: {
            biSize: 40,
            biWidth: rect.width,
            // Negative height → top-down row order.
            biHeight: -rect.height,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB,
            biSizeImage: 0,
            biXPelsPerMeter: 0,
            biYPelsPerMeter: 0,
            biClrUsed: 0,
            biClrImportant: 0,
          },
          bmiColors: [0],
        });
        const ppvBits = new BigUint64Array(1);
        hDib = CreateDIBSection(
          hdcMem,
          bmiPtr,
          DIB_RGB_COLORS,
          ppvBits,
          null,
          0,
        );
        if (!hDib || ppvBits[0] === 0n) {
          throw new Error('CreateDIBSection failed');
        }
        const old = SelectObject(hdcMem, hDib);
        try {
          if (
            !BitBlt(
              hdcMem,
              0,
              0,
              rect.width,
              rect.height,
              hdcScreen,
              rect.left,
              rect.top,
              SRCCOPY | CAPTUREBLT,
            )
          ) {
            throw new Error('BitBlt failed');
          }
          const byteLength = rect.width * rect.height * 4;
          // The DIB section is ours and lives until DeleteObject; COPY it out
          // before releasing the DC so nothing can repaint under us.
          const bgra = Buffer.from(
            new Uint8Array(koffi.view(ppvBits[0]!, byteLength)),
          );
          return {
            pixels: bgraToRgb(bgra, rect.width, rect.height),
            width: rect.width,
            height: rect.height,
          };
        } finally {
          SelectObject(hdcMem, old);
        }
      } finally {
        if (hDib) DeleteObject(hDib);
        koffi.free(bmiPtr);
      }
    } finally {
      DeleteDC(hdcMem);
    }
  } finally {
    DeleteDC(hdcScreen);
  }
}

/** BGRA (DIB native order) → tightly packed RGB for sharp's raw input. */
function bgraToRgb(bgra: Buffer, width: number, height: number): Buffer {
  const pixelCount = width * height;
  const rgb = Buffer.allocUnsafe(pixelCount * 3);
  for (let i = 0, j = 0; i < pixelCount; i += 1, j += 4) {
    const o = i * 3;
    rgb[o] = bgra[j + 2]!;
    rgb[o + 1] = bgra[j + 1]!;
    rgb[o + 2] = bgra[j]!;
  }
  return rgb;
}

/** Encode captured RGB pixels: optional LANCZOS downscale, then JPEG q0.75. */
async function encode(
  pixels: Buffer,
  width: number,
  height: number,
  options: CaptureOptions,
): Promise<{ base64: string; width: number; height: number }> {
  let pipeline = sharp(pixels, {
    raw: { width, height, channels: 3 },
  });
  if (
    options.targetWidth &&
    options.targetHeight &&
    (options.targetWidth !== width || options.targetHeight !== height)
  ) {
    pipeline = pipeline.resize(options.targetWidth, options.targetHeight, {
      kernel: 'lanczos3',
      fit: 'fill',
    });
  }
  const jpeg = await pipeline
    .jpeg({ quality: 75, optimiseCoding: true })
    .toBuffer();
  return {
    base64: jpeg.toString('base64'),
    width: options.targetWidth ?? width,
    height: options.targetHeight ?? height,
  };
}

/** Capture one display, optionally pre-scaled to the image budget. */
export async function captureDisplay(
  displayId: number | undefined,
  options: CaptureOptions = {},
): Promise<ScreenshotResult> {
  const displays = listDisplays();
  const display = chooseDisplay(displays, displayId);
  const raw = captureRaw({
    left: display.originX,
    top: display.originY,
    width: display.width,
    height: display.height,
  });
  const encoded = await encode(raw.pixels, raw.width, raw.height, options);
  return {
    base64: encoded.base64,
    width: encoded.width,
    height: encoded.height,
    displayWidth: display.width,
    displayHeight: display.height,
    displayId: display.displayId,
    originX: display.originX,
    originY: display.originY,
  };
}

/** Capture an arbitrary screen region (zoom). */
export async function captureRegion(
  region: { x: number; y: number; width: number; height: number },
  options: CaptureOptions = {},
): Promise<{ base64: string; width: number; height: number }> {
  const raw = captureRaw({
    left: region.x,
    top: region.y,
    width: region.width,
    height: region.height,
  });
  return encode(raw.pixels, raw.width, raw.height, options);
}
