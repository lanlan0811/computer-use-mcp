import { describe, expect, it, vi } from 'vitest';

import {
  coordToPercentageForPixelCompare,
  imagePixelsFromLogical,
  scaleCoordPixels,
} from '../../src/core/coordinates.js';
import type {
  DisplayGeometry,
  ScreenshotResult,
} from '../../src/core/types.js';

const display: DisplayGeometry = {
  displayId: 1,
  width: 1920,
  height: 1080,
  scaleFactor: 1.5,
  originX: 0,
  originY: 0,
  label: 'left',
};

const shot: ScreenshotResult = {
  base64: 'AAAA',
  // downscaled image, as delivered to the model
  width: 1280,
  height: 720,
  // physical display at capture time
  displayWidth: 2880,
  displayHeight: 1620,
  displayId: 1,
  originX: 0,
  originY: 0,
};

describe('scaleCoordPixels', () => {
  it('scales image pixels through the capture-time display ratio', () => {
    const p = scaleCoordPixels(640, 360, display, shot);
    // 640 * (2880 / 1280) = 1440; 360 * (1620 / 720) = 810
    expect(p).toEqual({ x: 1440, y: 810 });
  });

  it('adds the capture-time origin so multi-monitor clicks land right', () => {
    const shotOnSecond: ScreenshotResult = {
      ...shot,
      originX: 1920,
      originY: 100,
    };
    const p = scaleCoordPixels(0, 0, display, shotOnSecond);
    expect(p).toEqual({ x: 1920, y: 100 });
  });

  it('does NOT use 1/scaleFactor when a screenshot exists', () => {
    // The ratio that would break: 640 / 1.5 = 427, not 1440.
    const p = scaleCoordPixels(640, 0, display, shot);
    expect(p.x).not.toBe(427);
  });

  it('cold start: falls back to /scaleFactor and warns', () => {
    const warn = vi.fn();
    const p = scaleCoordPixels(960, 540, display, undefined, { warn });
    // 960 / 1.5 = 640; 540 / 1.5 = 360
    expect(p).toEqual({ x: 640, y: 360 });
    expect(warn).toHaveBeenCalledOnce();
  });

  it('cold start without a logger still computes', () => {
    const p = scaleCoordPixels(150, 150, display, undefined);
    expect(p).toEqual({ x: 100, y: 100 });
  });
});

describe('coordToPercentageForPixelCompare', () => {
  it('converts image pixels to percentage of the screenshot', () => {
    const p = coordToPercentageForPixelCompare(640, 360, shot);
    expect(p).toEqual({ xPct: 50, yPct: 50 });
  });

  it('cold start returns 0,0 (never reaches a crop)', () => {
    expect(coordToPercentageForPixelCompare(10, 20, undefined)).toEqual({
      xPct: 0,
      yPct: 0,
    });
  });
});

describe('imagePixelsFromLogical', () => {
  it('inverts scaleCoordPixels through the capture-time ratio', () => {
    const p = imagePixelsFromLogical(1440, 810, shot);
    expect(p).toEqual({ x: 640, y: 360 });
  });

  it('returns null when no screenshot exists', () => {
    expect(imagePixelsFromLogical(10, 20, undefined)).toBeNull();
  });

  it('returns null when the cursor is on a different display', () => {
    expect(imagePixelsFromLogical(5000, 10, shot)).toBeNull();
  });

  it('round-trips through scaleCoordPixels', () => {
    const scaled = scaleCoordPixels(123, 456, display, shot);
    const back = imagePixelsFromLogical(scaled.x, scaled.y, shot);
    expect(back).toEqual({ x: 123, y: 456 });
  });
});
