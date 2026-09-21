import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_GRID_SIZE,
  comparePixelAtLocation,
  computeCropRect,
  validateClickTarget,
} from '../../src/core/pixelCompare.js';
import type { ScreenshotResult } from '../../src/core/types.js';

const shot = (base64: string): ScreenshotResult => ({
  base64,
  width: 1000,
  height: 500,
  displayWidth: 2000,
  displayHeight: 1000,
  displayId: 1,
  originX: 0,
  originY: 0,
});

describe('computeCropRect', () => {
  it('centers the grid on the target', () => {
    // center (500, 250), half-grid 4 → x 496, y 246, 9×9.
    expect(computeCropRect(1000, 500, 50, 50, 9)).toEqual({
      x: 496,
      y: 246,
      width: 9,
      height: 9,
    });
  });

  it('clamps the rect at the image edges', () => {
    const rect = computeCropRect(1000, 500, 0, 0, 9);
    expect(rect).toEqual({ x: 0, y: 0, width: 9, height: 9 });
    // center clamps to (1000, 500) → 4x4 patch against the bottom-right edge.
    const corner = computeCropRect(1000, 500, 100, 100, 9);
    expect(corner).toEqual({ x: 996, y: 496, width: 4, height: 4 });
  });

  it('clamps percentages outside 0-100', () => {
    const rect = computeCropRect(1000, 500, -50, 250, 9);
    expect(rect?.x).toBe(0);
  });

  it('returns null for zero dimensions', () => {
    expect(computeCropRect(0, 500, 50, 50, 9)).toBeNull();
    expect(computeCropRect(1000, 0, 50, 50, 9)).toBeNull();
  });

  it('defaults to the 9x9 grid', () => {
    expect(DEFAULT_GRID_SIZE).toBe(9);
  });
});

describe('comparePixelAtLocation', () => {
  const cropEq = () => Buffer.from([1, 2, 3]);
  const cropDiff = (b64: string) =>
    b64 === 'a' ? Buffer.from([1, 2, 3]) : Buffer.from([9, 9, 9]);

  it('true when patches are byte-identical', () => {
    expect(comparePixelAtLocation(cropEq, shot('a'), shot('b'), 50, 50)).toBe(
      true,
    );
  });

  it('false when patches differ', () => {
    expect(comparePixelAtLocation(cropDiff, shot('a'), shot('b'), 50, 50)).toBe(
      false,
    );
  });

  it('false (skipped by caller) when the crop fails', () => {
    const cropNull = () => null;
    expect(comparePixelAtLocation(cropNull, shot('a'), shot('b'), 50, 50)).toBe(
      false,
    );
  });
});

describe('validateClickTarget', () => {
  const logger = { debug: vi.fn() };
  const cropEq = () => Buffer.from([1, 2, 3]);

  it('skips on cold start (no last screenshot)', async () => {
    const result = await validateClickTarget(
      cropEq,
      undefined,
      50,
      50,
      async () => shot('fresh'),
      logger,
    );
    expect(result).toEqual({ valid: true, skipped: true });
  });

  it('skips when the fresh screenshot fails', async () => {
    const result = await validateClickTarget(
      cropEq,
      shot('last'),
      50,
      50,
      async () => null,
      logger,
    );
    expect(result).toEqual({ valid: true, skipped: true });
  });

  it('skips (valid) when the fresh screenshot throws', async () => {
    const result = await validateClickTarget(
      cropEq,
      shot('last'),
      50,
      50,
      async () => {
        throw new Error('capture failed');
      },
      logger,
    );
    expect(result).toEqual({ valid: true, skipped: true });
    expect(logger.debug).toHaveBeenCalledOnce();
  });

  it('valid, not skipped, when pixels match', async () => {
    const result = await validateClickTarget(
      cropEq,
      shot('last'),
      50,
      50,
      async () => shot('fresh'),
      logger,
    );
    expect(result).toEqual({ valid: true, skipped: false });
  });

  it('invalid with a warning when the target changed', async () => {
    const cropDiff = (b64: string) =>
      b64 === 'last' ? Buffer.from([1, 2, 3]) : Buffer.from([9, 9, 9]);
    const result = await validateClickTarget(
      cropDiff,
      shot('last'),
      50,
      50,
      async () => shot('fresh'),
      logger,
    );
    expect(result.valid).toBe(false);
    expect(result.skipped).toBe(false);
    expect(result.warning).toMatch(/changed since the last screenshot/);
  });
});
