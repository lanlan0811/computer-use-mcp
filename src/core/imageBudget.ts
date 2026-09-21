/**
 * Image budget: the largest same-aspect size that satisfies BOTH the long-edge
 * cap and the token budget.
 *
 * Port of the API transcoder's target-size algorithm (cc-haha
 * imageResize.ts:60-108, itself matching api resize.rs:91-155). Pre-sizing to
 * this function's output makes the API's early-return fire, so the model sees
 * exactly the dimensions in `ScreenshotResult.width/height` and click
 * coordinates stay coherent. Without the pre-scale the API re-encodes
 * server-side and clicks land ~14% off.
 *
 * The long-edge constraint alone is insufficient on squarer-than-16:9
 * displays: 1568×1014 is 56×37 = 2072 tokens, over budget, and gets
 * server-resized to 1372×887 — leaving the model clicking in 1568-space while
 * the server scaled to 1372-space.
 */

export interface ResizeParams {
  pxPerToken: number;
  maxTargetPx: number;
  maxTargetTokens: number;
}

/** Production defaults: 28px tiles, 1568 is both the edge cap and the budget. */
export const API_RESIZE_PARAMS: ResizeParams = {
  pxPerToken: 28,
  maxTargetPx: 1568,
  maxTargetTokens: 1568,
};

/** ceil(px / pxPerToken). Integer ceil-div, matching resize.rs:74-76. */
export function nTokensForPx(px: number, pxPerToken: number): number {
  return Math.floor((px - 1) / pxPerToken) + 1;
}

function nTokensForImg(
  width: number,
  height: number,
  pxPerToken: number,
): number {
  return nTokensForPx(width, pxPerToken) * nTokensForPx(height, pxPerToken);
}

/**
 * Binary-search along the width dimension for the largest image that:
 *   - preserves the input aspect ratio
 *   - has long edge ≤ maxTargetPx
 *   - has ceil(w/pxPerToken) × ceil(h/pxPerToken) ≤ maxTargetTokens
 *
 * Returns [width, height]. No-op if the input already satisfies all three.
 */
export function targetImageSize(
  width: number,
  height: number,
  params: ResizeParams,
): [number, number] {
  const { pxPerToken, maxTargetPx, maxTargetTokens } = params;

  if (
    width <= maxTargetPx &&
    height <= maxTargetPx &&
    nTokensForImg(width, height, pxPerToken) <= maxTargetTokens
  ) {
    return [width, height];
  }

  // Normalize to landscape for the search; transpose the result back.
  if (height > width) {
    const [w, h] = targetImageSize(height, width, params);
    return [h, w];
  }

  const aspectRatio = width / height;

  // Loop invariant: lowerBoundWidth is always valid, upperBoundWidth is
  // always invalid. ~12 iterations for a 4000px image.
  let upperBoundWidth = width;
  let lowerBoundWidth = 1;

  for (;;) {
    if (lowerBoundWidth + 1 === upperBoundWidth) {
      return [
        lowerBoundWidth,
        Math.max(Math.round(lowerBoundWidth / aspectRatio), 1),
      ];
    }

    const middleWidth = Math.floor((lowerBoundWidth + upperBoundWidth) / 2);
    const middleHeight = Math.max(Math.round(middleWidth / aspectRatio), 1);

    if (
      middleWidth <= maxTargetPx &&
      nTokensForImg(middleWidth, middleHeight, pxPerToken) <= maxTargetTokens
    ) {
      lowerBoundWidth = middleWidth;
    } else {
      upperBoundWidth = middleWidth;
    }
  }
}
