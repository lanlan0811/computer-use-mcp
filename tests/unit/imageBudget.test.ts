import { describe, expect, it } from 'vitest';

import {
  API_RESIZE_PARAMS,
  nTokensForPx,
  targetImageSize,
} from '../../src/core/imageBudget.js';

const P = API_RESIZE_PARAMS;

describe('nTokensForPx', () => {
  it('ceil-divides', () => {
    expect(nTokensForPx(1, 28)).toBe(1);
    expect(nTokensForPx(28, 28)).toBe(1);
    expect(nTokensForPx(29, 28)).toBe(2);
    expect(nTokensForPx(1568, 28)).toBe(56);
  });
});

describe('targetImageSize', () => {
  it('no-ops when the image already fits both budgets', () => {
    expect(targetImageSize(1280, 720, P)).toEqual([1280, 720]);
    // 50×29 = 1450 tokens ≤ 1568 → fits.
    expect(targetImageSize(1400, 800, P)).toEqual([1400, 800]);
    // Exactly 56 tokens wide but 1792 total → does NOT fit, must shrink.
    expect(targetImageSize(1568, 882, P)).not.toEqual([1568, 882]);
  });

  it('honors the long-edge cap alone', () => {
    expect(targetImageSize(3000, 1000, P)).toEqual([1568, 523]);
  });

  it('handles the cc-haha documented case: 1568×1014 is over the TOKEN budget', () => {
    // 56×37 = 2072 tokens > 1568 → server would resize to 1372×887.
    // The model must never see the pre-resize dimensions.
    expect(targetImageSize(1568, 1014, P)).toEqual([1372, 887]);
  });

  it('handles the squarer-than-16:9 extreme: a square image', () => {
    // 1568×1568 is 56×56 = 3136 tokens; budget caps it near ~1156×1156.
    const [w, h] = targetImageSize(2000, 2000, P);
    expect(w).toBe(h);
    expect(nTokensForPx(w, 28) * nTokensForPx(h, 28)).toBeLessThanOrEqual(1568);
    expect(w).toBeLessThanOrEqual(1568);
    // The largest valid square width: the search must be maximal.
    expect(nTokensForPx(w + 1, 28) * nTokensForPx(h + 1, 28)).toBeGreaterThan(
      1568,
    );
  });

  it('transposes portrait images and back', () => {
    const [w, h] = targetImageSize(1014, 1568, P);
    expect(w).toBe(887);
    expect(h).toBe(1372);
  });

  it('handles an extreme panorama (very wide)', () => {
    const [w, h] = targetImageSize(8000, 600, P);
    expect(w).toBe(1568);
    expect(h).toBe(118);
    // 56 tokens wide; ceil(118/28)=5 → 280 total tokens.
    expect(nTokensForPx(w, 28) * nTokensForPx(h, 28)).toBeLessThanOrEqual(1568);
  });

  it('never returns a zero dimension', () => {
    const [w, h] = targetImageSize(5000, 3, P);
    expect(w).toBeGreaterThan(0);
    expect(h).toBeGreaterThan(0);
  });

  it('keeps the aspect ratio within one pixel of rounding', () => {
    const [w, h] = targetImageSize(3840, 2160, P);
    const expectedAr = 3840 / 2160;
    expect(Math.abs(w / h - expectedAr)).toBeLessThan(0.01);
  });
});
