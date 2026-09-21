/**
 * Error-code mapping contract: every code the worker can emit must exist in
 * the core error table, and the no-retry codes must match exactly.
 *
 * Collapsing "not sent, safe to retry" into "sent, outcome unknown" is the
 * bug that makes a model flip the same switch over and over — this test keeps
 * the two sets honest (plan §7.3).
 */

import { describe, expect, it } from 'vitest';

import { CuToolError, formatToolErrorText } from '../../src/core/errors.js';
import type { CuErrorCode } from '../../src/core/errors.js';
import {
  MUTATING_COMMANDS,
  UnknownActionError,
  coordinateOf,
  errorCodeOf,
} from '../../src/worker/actions.js';
import { WORKER_TO_CORE_ERROR_CODE } from '../../src/worker/protocol.js';
import { UserInterference } from '../../src/worker/lease/lease.js';
import { DeliveryRefused } from '../../src/worker/guards/delivery.js';
import { InputMonitorUnavailable } from '../../src/worker/lease/monitor.js';

/** The core table, mirrored from src/core/errors.ts. */
const CORE_CODES: readonly CuErrorCode[] = [
  'user_interference',
  'user_interference_result_unknown',
  'point_outside_display',
  'target_window_offscreen',
  'input_injection_failed',
  'input_injection_result_unknown',
  'worker_crashed_result_unknown',
  'input_monitor_unavailable',
  'cu_lock_held',
  'state_conflict',
  'grant_flag_required',
  'bad_args',
  'capture_failed',
  'display_error',
  'feature_unavailable',
  'teach_mode_conflict',
  'teach_mode_not_active',
  'other',
  'runtime_error',
];

/** Codes that forbid retrying the action (plan §7.3). */
const NO_RETRY: readonly string[] = [
  'user_interference_result_unknown',
  'input_injection_result_unknown',
  'worker_crashed_result_unknown',
];

describe('worker → core error-code mapping', () => {
  it('every worker code maps to a core-table code', () => {
    for (const [workerCode, coreCode] of Object.entries(
      WORKER_TO_CORE_ERROR_CODE,
    )) {
      expect(
        CORE_CODES as readonly string[],
        `${workerCode} maps outside the core table`,
      ).toContain(coreCode);
    }
  });

  it('the identity family and the one documented divergence', () => {
    expect(WORKER_TO_CORE_ERROR_CODE.user_interference).toBe(
      'user_interference',
    );
    expect(WORKER_TO_CORE_ERROR_CODE.user_interference_result_unknown).toBe(
      'user_interference_result_unknown',
    );
    expect(WORKER_TO_CORE_ERROR_CODE.worker_internal).toBe('runtime_error');
  });

  it('errorCodeOf maps each typed exception to its code', () => {
    expect(errorCodeOf(new UserInterference('x'))).toBe('user_interference');
    expect(
      errorCodeOf(
        new UserInterference('x', 'user_interference_result_unknown'),
      ),
    ).toBe('user_interference_result_unknown');
    expect(errorCodeOf(new DeliveryRefused('x', 'point_outside_display'))).toBe(
      'point_outside_display',
    );
    expect(
      errorCodeOf(new DeliveryRefused('x', 'target_window_offscreen')),
    ).toBe('target_window_offscreen');
    expect(errorCodeOf(new InputMonitorUnavailable('x'))).toBe(
      'input_monitor_unavailable',
    );
    expect(errorCodeOf(new UnknownActionError('nope'))).toBe('bad_args');
    expect(errorCodeOf({ code: 'input_injection_failed' })).toBe(
      'input_injection_failed',
    );
    expect(errorCodeOf(new Error('plain'))).toBe('worker_internal');
  });

  it('the no-retry set is exactly the UNKNOWN family', () => {
    for (const code of NO_RETRY) {
      expect(code.endsWith('_unknown')).toBe(true);
    }
    // ...and user_interference (safe to retry) is NOT in it.
    expect(NO_RETRY).not.toContain('user_interference');
  });

  it('the retryable refusals are the safe ones', () => {
    for (const code of [
      'point_outside_display',
      'target_window_offscreen',
      'cu_lock_held',
      'bad_args',
    ]) {
      expect(NO_RETRY).not.toContain(code);
    }
  });
});

describe('mutating-command table', () => {
  it('covers every input-injecting action and nothing else', () => {
    expect([...MUTATING_COMMANDS].sort()).toEqual(
      [
        'click',
        'drag',
        'hold_key',
        'key',
        'mouse_down',
        'mouse_up',
        'move_mouse',
        'paste_clipboard',
        'scroll',
        'type',
      ].sort(),
    );
  });

  it('read-only actions are never leased', () => {
    for (const action of [
      'screenshot',
      'zoom',
      'cursor_position',
      'list_displays',
      'list_windows',
      'list_installed_apps',
      'read_clipboard',
      'write_clipboard',
      'frontmost_app',
      'app_under_point',
      'open_app',
      'ping',
      'check_permissions',
    ]) {
      expect(MUTATING_COMMANDS.has(action)).toBe(false);
    }
  });

  it('coordinateOf only reports the coordinates that need a screen check', () => {
    expect(coordinateOf('click', { x: 1, y: 2 })).toEqual({ x: 1, y: 2 });
    expect(coordinateOf('drag', { to: { x: 3, y: 4 } })).toEqual({
      x: 3,
      y: 4,
    });
    expect(coordinateOf('drag', {})).toBeNull();
    expect(coordinateOf('type', { text: 'x' })).toBeNull();
    expect(coordinateOf('key', { keySequence: 'a' })).toBeNull();
  });
});

describe('CuToolError', () => {
  it('formats with the machine-readable prefix', () => {
    const error = new CuToolError('user_interference', 'user moved the mouse');
    expect(formatToolErrorText(error.code, error.message)).toBe(
      'user_interference: user moved the mouse',
    );
  });
});
