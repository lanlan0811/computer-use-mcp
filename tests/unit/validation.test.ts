import { describe, expect, it } from 'vitest';

import {
  decodedByteLength,
  segmentGraphemes,
} from '../../src/core/graphemes.js';
import {
  asRecord,
  extractCoordinate,
  extractDuration,
  extractRegion,
  extractRepeat,
  extractScrollAmount,
  extractScrollDirection,
  requireNumber,
  requireString,
} from '../../src/core/validation.js';

describe('arg validation', () => {
  it('asRecord passes objects through and defaults others to {}', () => {
    expect(asRecord({ a: 1 })).toEqual({ a: 1 });
    expect(asRecord(null)).toEqual({});
    expect(asRecord('nope')).toEqual({});
  });

  it('requireNumber / requireString', () => {
    expect(requireNumber({ n: 1.5 }, 'n')).toBe(1.5);
    expect(requireNumber({ n: 'x' }, 'n')).toBeInstanceOf(Error);
    expect(requireNumber({ n: Infinity }, 'n')).toBeInstanceOf(Error);
    expect(requireString({ s: 'x' }, 's')).toBe('x');
    expect(requireString({ s: 1 }, 's')).toBeInstanceOf(Error);
  });

  it('extractCoordinate requires a non-negative pair', () => {
    expect(extractCoordinate({ coordinate: [1, 2] })).toEqual([1, 2]);
    expect(extractCoordinate({})).toBeInstanceOf(Error);
    expect(extractCoordinate({ coordinate: [1] })).toBeInstanceOf(Error);
    expect(extractCoordinate({ coordinate: [1, 'a'] })).toBeInstanceOf(Error);
    expect(extractCoordinate({ coordinate: [-1, 2] })).toBeInstanceOf(Error);
  });

  it('extractRegion validates shape and ordering', () => {
    expect(extractRegion({ region: [0, 0, 10, 10] })).toEqual({
      x0: 0,
      y0: 0,
      x1: 10,
      y1: 10,
    });
    expect(extractRegion({ region: [0, 0, 10] })).toBeInstanceOf(Error);
    expect(extractRegion({ region: [10, 0, 10, 5] })).toBeInstanceOf(Error);
    expect(extractRegion({ region: [0, 5, 10, 5] })).toBeInstanceOf(Error);
    expect(extractRegion({ region: [-1, 0, 10, 5] })).toBeInstanceOf(Error);
  });

  it('extractRepeat bounds 1..100', () => {
    expect(extractRepeat({})).toBeUndefined();
    expect(extractRepeat({ repeat: 3 })).toBe(3);
    expect(extractRepeat({ repeat: 0 })).toBeInstanceOf(Error);
    expect(extractRepeat({ repeat: 101 })).toBeInstanceOf(Error);
    expect(extractRepeat({ repeat: 2.5 })).toBeInstanceOf(Error);
  });

  it('extractDuration bounds 0..100 seconds', () => {
    expect(extractDuration({ duration: 0 })).toBe(0);
    expect(extractDuration({ duration: 100 })).toBe(100);
    expect(extractDuration({ duration: -1 })).toBeInstanceOf(Error);
    expect(extractDuration({ duration: 101 })).toBeInstanceOf(Error);
    expect(extractDuration({ duration: 'x' })).toBeInstanceOf(Error);
  });

  it('scroll arg validation', () => {
    expect(extractScrollDirection({ scroll_direction: 'up' })).toBe('up');
    expect(
      extractScrollDirection({ scroll_direction: 'sideways' }),
    ).toBeInstanceOf(Error);
    expect(extractScrollAmount({ scroll_amount: 0 })).toBe(0);
    expect(extractScrollAmount({ scroll_amount: 100 })).toBe(100);
    expect(extractScrollAmount({ scroll_amount: 101 })).toBeInstanceOf(Error);
    expect(extractScrollAmount({ scroll_amount: -1 })).toBeInstanceOf(Error);
    expect(extractScrollAmount({ scroll_amount: 1.5 })).toBeInstanceOf(Error);
  });
});

describe('segmentGraphemes', () => {
  it('keeps ZWJ emoji sequences whole', () => {
    const family = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}';
    expect(segmentGraphemes(family)).toEqual([family]);
  });

  it('splits plain text per character', () => {
    expect(segmentGraphemes('abc')).toEqual(['a', 'b', 'c']);
  });

  it('keeps surrogate pairs together', () => {
    expect(segmentGraphemes('\u{1F600}')).toEqual(['\u{1F600}']);
  });
});

describe('decodedByteLength', () => {
  it('computes the decoded size of base64 payloads', () => {
    // 4 chars → 3 bytes
    expect(decodedByteLength('AAAA')).toBe(3);
    // 8 chars with one padding → 5 bytes
    expect(decodedByteLength('AAAAAAAA')).toBe(6);
    expect(decodedByteLength('AA==')).toBe(1);
    expect(decodedByteLength('AAA=')).toBe(2);
  });

  it('distinguishes implausibly small buffers', () => {
    expect(decodedByteLength('AAAA')).toBeLessThan(1024);
    expect(decodedByteLength('A'.repeat(2048))).toBeGreaterThan(1024);
  });
});
