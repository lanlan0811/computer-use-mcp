/**
 * Error codes and tool-error result shaping.
 *
 * The codes carry semantics the model depends on: "not sent, safe to retry"
 * versus "sent, outcome unknown". Collapsing the two into one generic error
 * is exactly what makes a model flip the same switch over and over — every
 * code below maps to a retry policy in the instructions text (plan §7.3).
 */

export type CuErrorCode =
  /** Physical input detected BEFORE the action was sent — safe to retry. */
  | 'user_interference'
  /** Physical input (or a foreground change) DURING the action — outcome
   *  unknown, must screenshot before doing anything else. */
  | 'user_interference_result_unknown'
  /** Coordinate is not inside any display. */
  | 'point_outside_display'
  /** Target window is minimized, hidden, or zero-area. */
  | 'target_window_offscreen'
  /** SendInput refused the whole batch (elevated target / secure desktop). */
  | 'input_injection_failed'
  /** SendInput accepted only part of the batch. */
  | 'input_injection_result_unknown'
  /** Worker crashed and the action may already have been sent. */
  | 'worker_crashed_result_unknown'
  /** The interference monitor could not be established or stopped. */
  | 'input_monitor_unavailable'
  /** Another session holds the cross-process computer-use lock. */
  | 'cu_lock_held'
  /** State conflict: foreground unidentifiable, button already held, ... */
  | 'state_conflict'
  /** Action needs a grant flag the operator has not enabled. */
  | 'grant_flag_required'
  /** Malformed arguments (type, shape, range, unknown enum value). */
  | 'bad_args'
  /** Screenshot capture failed. */
  | 'capture_failed'
  /** Display enumeration failed. */
  | 'display_error'
  /** The capability is not available in this session. */
  | 'feature_unavailable'
  /** Reserved for the (unimplemented) teach-mode family. */
  | 'teach_mode_conflict'
  | 'teach_mode_not_active'
  /** Unclassified failure. */
  | 'other'
  /** Unclassified runtime failure. */
  | 'runtime_error';

/** Error thrown by core logic; carries a machine-readable code. */
export class CuToolError extends Error {
  readonly code: CuErrorCode;

  constructor(code: CuErrorCode, message: string) {
    super(message);
    this.name = 'CuToolError';
    this.code = code;
  }
}

/** One text content block of an MCP tool result. */
export interface CuTextContent {
  type: 'text';
  text: string;
}

/** The error-shaped tool result the MCP layer returns to the model. */
export interface CuErrorResult {
  content: CuTextContent[];
  isError: true;
}

/**
 * Render the machine-readable prefix the model parses first. Everything after
 * the colon is human/model-facing prose.
 */
export function formatToolErrorText(
  code: CuErrorCode,
  message: string,
): string {
  return `${code}: ${message}`;
}

/** Build an isError tool result with the code-prefixed text. */
export function toolError(code: CuErrorCode, message: string): CuErrorResult {
  return {
    content: [{ type: 'text', text: formatToolErrorText(code, message) }],
    isError: true,
  };
}

/** Build a plain (non-error) text tool result. */
export function toolText(text: string): { content: CuTextContent[] } {
  return { content: [{ type: 'text', text }] };
}
