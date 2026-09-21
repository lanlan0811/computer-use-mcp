/**
 * Grapheme-cluster segmentation and small screenshot helpers.
 *
 * Port of windowsLegacyToolCalls.ts:385-436. On Windows the whole type action
 * runs inside one worker call (per-character pacing lives there), so the
 * grapheme count is used for the receipt message; segmentation still matters
 * for ZWJ emoji, which must not be split into replacement characters.
 */

/** Battle-tested threshold: a screenshot smaller than this is implausible. */
export const MIN_SCREENSHOT_BYTES = 1024;

/** Decoded byte length of a base64 payload (good enough for a threshold). */
export function decodedByteLength(base64: string): number {
  // 3 bytes per 4 chars, minus padding.
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/**
 * Split text into grapheme clusters. Node 18+ has Intl.Segmenter; the try is
 * defence against a stripped-down runtime (falls back to code points).
 * Code-point iteration keeps surrogate pairs together but splits ZWJ.
 */
export function segmentGraphemes(text: string): string[] {
  try {
    const Segmenter = (
      Intl as typeof Intl & {
        Segmenter?: new (
          locale?: string,
          options?: { granularity: 'grapheme' | 'word' | 'sentence' },
        ) => { segment: (s: string) => Iterable<{ segment: string }> };
      }
    ).Segmenter;
    if (typeof Segmenter === 'function') {
      const seg = new Segmenter(undefined, { granularity: 'grapheme' });
      return Array.from(seg.segment(text), (s) => s.segment);
    }
  } catch {
    // fall through
  }
  return Array.from(text);
}
