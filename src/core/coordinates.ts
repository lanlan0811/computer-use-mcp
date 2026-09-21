/**
 * Coordinate transform: model image-pixel space → virtual-screen pixels.
 *
 * Coordinate mode is frozen to `pixels` at startup (plan §8): the tool
 * descriptions and this transform must read the same value or clicks land in
 * the wrong space, so there is deliberately no mode switch.
 *
 * The transform uses the display geometry stashed AT CAPTURE TIME
 * (`lastScreenshot.displayWidth/originX`), not a fresh measurement: after the
 * 1568 long-edge downscale, screenshot.width ≠ display.width × scaleFactor,
 * so the correct ratio is displayWidth / screenshot.width. Using 1/scaleFactor
 * instead would click ~14% off whenever the downscale is active.
 *
 * Port of windowsLegacyToolCalls.ts:203-247 (pixels branch only).
 */

import type { DisplayGeometry, ScreenshotResult } from './types.js';

export interface VirtualPoint {
  x: number;
  y: number;
}

/**
 * Convert model-space pixel coordinates to virtual-screen pixels.
 *
 * With a prior screenshot: `x = round(rawX × displayWidth / width) + originX`.
 * Cold start (no screenshot yet): degenerate fallback to `rawX / scaleFactor`
 * with a warning — the click may be off if the downscale is active.
 */
export function scaleCoordPixels(
  rawX: number,
  rawY: number,
  display: DisplayGeometry,
  lastScreenshot: ScreenshotResult | undefined,
  logger?: { warn(message: string, ...args: unknown[]): void },
): VirtualPoint {
  if (lastScreenshot) {
    return {
      x:
        Math.round(
          rawX * (lastScreenshot.displayWidth / lastScreenshot.width),
        ) + lastScreenshot.originX,
      y:
        Math.round(
          rawY * (lastScreenshot.displayHeight / lastScreenshot.height),
        ) + lastScreenshot.originY,
    };
  }

  logger?.warn(
    '[computer-use] pixels-mode coordinate received with no prior screenshot; ' +
      'falling back to /scaleFactor. Click may be off if downsample is active.',
  );
  return {
    x: Math.round(rawX / display.scaleFactor) + display.originX,
    y: Math.round(rawY / display.scaleFactor) + display.originY,
  };
}

/**
 * Convert model-space pixel coordinates to the 0–100 percentage space
 * pixelCompare works in. The model's raw pixel coordinate is already in the
 * last screenshot's image space, so the denominator is just its width.
 *
 * Port of windowsLegacyToolCalls.ts:261-282 (pixels branch only).
 */
export function coordToPercentageForPixelCompare(
  rawX: number,
  rawY: number,
  lastScreenshot: ScreenshotResult | undefined,
): { xPct: number; yPct: number } {
  if (!lastScreenshot) {
    // validateClickTarget skips when lastScreenshot is undefined, so this
    // value never reaches a crop.
    return { xPct: 0, yPct: 0 };
  }
  return {
    xPct: (rawX / lastScreenshot.width) * 100,
    yPct: (rawY / lastScreenshot.height) * 100,
  };
}

/**
 * Inverse of scaleCoordPixels: virtual-screen pixels → model image pixels.
 * Used by cursor_position so the returned coordinates match what the model
 * would read off its last screenshot. Returns logical points when the cursor
 * is on a different display than the captured one.
 *
 * Port of windowsLegacyToolCalls.ts:2571-2608.
 */
export function imagePixelsFromLogical(
  logicalX: number,
  logicalY: number,
  lastScreenshot: ScreenshotResult | undefined,
): { x: number; y: number } | null {
  if (!lastScreenshot) return null;
  const localX = logicalX - lastScreenshot.originX;
  const localY = logicalY - lastScreenshot.originY;
  if (
    localX < 0 ||
    localX > lastScreenshot.displayWidth ||
    localY < 0 ||
    localY > lastScreenshot.displayHeight
  ) {
    return null;
  }
  return {
    x: Math.round(
      localX * (lastScreenshot.width / lastScreenshot.displayWidth),
    ),
    y: Math.round(
      localY * (lastScreenshot.height / lastScreenshot.displayHeight),
    ),
  };
}
