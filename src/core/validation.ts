/**
 * Lightweight argument validation — no zod, cast-and-check.
 *
 * Port of the validation helpers in windowsLegacyToolCalls.ts:134-183. Every
 * failure returns an Error; the dispatch layer converts it to a `bad_args`
 * tool error. Validation never touches system state.
 */

export type Args = Record<string, unknown>;

export function asRecord(args: unknown): Args {
  if (typeof args === 'object' && args !== null) {
    return args as Args;
  }
  return {};
}

export function requireNumber(args: Args, key: string): number | Error {
  const v = args[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    return new Error(`"${key}" must be a finite number.`);
  }
  return v;
}

export function requireString(args: Args, key: string): string | Error {
  const v = args[key];
  if (typeof v !== 'string') {
    return new Error(`"${key}" must be a string.`);
  }
  return v;
}

/** Extract (x, y) from a `coordinate: [x, y]` tuple of non-negative numbers. */
export function extractCoordinate(
  args: Args,
  paramName: string = 'coordinate',
): [number, number] | Error {
  const coord = args[paramName];
  if (coord === undefined) {
    return new Error(`${paramName} is required`);
  }
  if (!Array.isArray(coord) || coord.length !== 2) {
    return new Error(`${paramName} must be an array of length 2`);
  }
  const [x, y] = coord;
  if (typeof x !== 'number' || typeof y !== 'number' || x < 0 || y < 0) {
    return new Error(`${paramName} must be a tuple of non-negative numbers`);
  }
  return [x, y];
}

/** Extract and range-check a `region: [x0, y0, x1, y1]` rectangle. */
export function extractRegion(args: Args):
  | {
      x0: number;
      y0: number;
      x1: number;
      y1: number;
    }
  | Error {
  const region = args.region;
  if (!Array.isArray(region) || region.length !== 4) {
    return new Error('region must be an array of length 4: [x0, y0, x1, y1]');
  }
  const [x0, y0, x1, y1] = region;
  if (
    typeof x0 !== 'number' ||
    typeof y0 !== 'number' ||
    typeof x1 !== 'number' ||
    typeof y1 !== 'number' ||
    x0 < 0 ||
    y0 < 0 ||
    x1 < 0 ||
    y1 < 0
  ) {
    return new Error('region values must be non-negative numbers');
  }
  if (x1 <= x0) return new Error('region x1 must be greater than x0');
  if (y1 <= y0) return new Error('region y1 must be greater than y0');
  return { x0, y0, x1, y1 };
}

/** Range-check a `repeat` argument (1–100). */
export function extractRepeat(args: Args): number | undefined | Error {
  if (args.repeat === undefined) return undefined;
  const repeat = args.repeat;
  if (typeof repeat !== 'number' || !Number.isInteger(repeat) || repeat < 1) {
    return new Error('repeat must be a positive integer');
  }
  if (repeat > 100) {
    return new Error('repeat exceeds maximum of 100');
  }
  return repeat;
}

/** Range-check a seconds-valued `duration` argument (0–100). */
export function extractDuration(args: Args, key = 'duration'): number | Error {
  const duration = args[key];
  if (typeof duration !== 'number' || !Number.isFinite(duration)) {
    return new Error(`${key} must be a number`);
  }
  if (duration < 0) {
    return new Error(`${key} must be non-negative`);
  }
  if (duration > 100) {
    return new Error(`${key} is too long. ${key} is in seconds.`);
  }
  return duration;
}

/** Validate `scroll_direction`. */
export function extractScrollDirection(
  args: Args,
): 'up' | 'down' | 'left' | 'right' | Error {
  const dir = args.scroll_direction;
  if (dir !== 'up' && dir !== 'down' && dir !== 'left' && dir !== 'right') {
    return new Error(
      "scroll_direction must be 'up', 'down', 'left', or 'right'",
    );
  }
  return dir;
}

/** Validate `scroll_amount` (0–100). */
export function extractScrollAmount(args: Args): number | Error {
  const amount = args.scroll_amount;
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 0) {
    return new Error('scroll_amount must be a non-negative int');
  }
  if (amount > 100) {
    return new Error('scroll_amount exceeds maximum of 100');
  }
  return amount;
}
