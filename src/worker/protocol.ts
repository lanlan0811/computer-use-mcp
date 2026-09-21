/**
 * Worker wire protocol (NDJSON over stdio, one JSON object per line).
 *
 * Redesigned from scratch (plan §5.4) — it does NOT mirror cc-haha's helper
 * command strings:
 *   request:  {"v":1,"id":1,"action":"click","payload":{...}}
 *   response: {"v":1,"id":1,"ok":true,"result":{...}}
 *             {"v":1,"id":1,"ok":false,"error":{"code":"...","message":"..."}}
 *
 * stdout carries the protocol ONLY; diagnostics go to stderr.
 *
 * Equivalence with cc-haha's Python helper is proven behaviorally by the
 * desktop test suite, not line-by-line (plan §12.2 note).
 */

/** Protocol version. A mismatch refuses startup with a clear error. */
export const PROTOCOL_VERSION = 1;

export interface WorkerRequest {
  v: number;
  id: number;
  action: string;
  payload?: Record<string, unknown>;
  /** Advisory hard timeout; the parent enforces it. */
  timeoutMs?: number;
}

export interface WorkerOkResponse {
  v: number;
  id: number;
  ok: true;
  result: unknown;
}

export interface WorkerErrorResponse {
  v: number;
  id: number;
  ok: false;
  error: {
    code: string;
    message: string;
  };
}

export type WorkerResponse = WorkerOkResponse | WorkerErrorResponse;

/**
 * Machine-readable error codes the worker can emit. All map 1:1 to the core
 * error-code table (see src/core/errors.ts) via WORKER_TO_CORE_ERROR_CODE;
 * the contract test asserts it.
 */
export type WorkerErrorCode =
  | 'user_interference'
  | 'user_interference_result_unknown'
  | 'point_outside_display'
  | 'target_window_offscreen'
  | 'input_injection_failed'
  | 'input_injection_result_unknown'
  | 'input_monitor_unavailable'
  | 'bad_args'
  | 'capture_failed'
  | 'display_error'
  | 'worker_internal';

/** Worker wire codes → core CuErrorCode values. Identity unless noted. */
export const WORKER_TO_CORE_ERROR_CODE: Readonly<
  Record<WorkerErrorCode, string>
> = {
  user_interference: 'user_interference',
  user_interference_result_unknown: 'user_interference_result_unknown',
  point_outside_display: 'point_outside_display',
  target_window_offscreen: 'target_window_offscreen',
  input_injection_failed: 'input_injection_failed',
  input_injection_result_unknown: 'input_injection_result_unknown',
  input_monitor_unavailable: 'input_monitor_unavailable',
  bad_args: 'bad_args',
  capture_failed: 'capture_failed',
  display_error: 'display_error',
  worker_internal: 'runtime_error',
};

export class ProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProtocolError';
  }
}

/** Parse and validate one NDJSON request line. Throws ProtocolError. */
export function decodeRequest(line: string): WorkerRequest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw new ProtocolError('line is not valid JSON');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ProtocolError('request must be a JSON object');
  }
  const req = parsed as Record<string, unknown>;
  if (req.v !== PROTOCOL_VERSION) {
    throw new ProtocolError(
      `unsupported protocol version ${String(req.v)}; expected ${PROTOCOL_VERSION}`,
    );
  }
  if (typeof req.id !== 'number' || !Number.isInteger(req.id) || req.id < 0) {
    throw new ProtocolError('request id must be a non-negative integer');
  }
  if (typeof req.action !== 'string' || req.action === '') {
    throw new ProtocolError('request action must be a non-empty string');
  }
  if (
    req.payload !== undefined &&
    (req.payload === null ||
      typeof req.payload !== 'object' ||
      Array.isArray(req.payload))
  ) {
    throw new ProtocolError('request payload must be an object when present');
  }
  if (req.timeoutMs !== undefined && typeof req.timeoutMs !== 'number') {
    throw new ProtocolError('request timeoutMs must be a number when present');
  }
  return {
    v: PROTOCOL_VERSION,
    id: req.id,
    action: req.action,
    payload: req.payload as Record<string, unknown> | undefined,
    timeoutMs: req.timeoutMs as number | undefined,
  };
}

/** Encode one response object as an NDJSON line (no trailing newline). */
export function encodeResponse(response: WorkerResponse): string {
  return JSON.stringify(response);
}

export function okResponse(id: number, result: unknown): WorkerOkResponse {
  return { v: PROTOCOL_VERSION, id, ok: true, result };
}

export function errorResponse(
  id: number,
  code: WorkerErrorCode | string,
  message: string,
): WorkerErrorResponse {
  return { v: PROTOCOL_VERSION, id, ok: false, error: { code, message } };
}

/** Split a buffer chunk into complete lines, keeping the remainder. */
export class LineFramer {
  private buffer = '';

  push(chunk: string): string[] {
    this.buffer += chunk;
    const lines: string[] = [];
    let index = this.buffer.indexOf('\n');
    while (index !== -1) {
      const line = this.buffer.slice(0, index).replace(/\r$/, '');
      if (line !== '') lines.push(line);
      this.buffer = this.buffer.slice(index + 1);
      index = this.buffer.indexOf('\n');
    }
    return lines;
  }

  /** Bytes after the last newline that never completed a line. */
  get pending(): string {
    return this.buffer;
  }
}
