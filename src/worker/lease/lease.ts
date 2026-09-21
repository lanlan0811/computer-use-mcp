/**
 * ForegroundLease: guard one mutating action against concurrent physical
 * input.
 *
 * Port of win_helper.py:1362-1473. The asymmetry between the two failure
 * modes is deliberate and is the whole point of the class:
 *
 *   * interference BEFORE the action → `user_interference`. Nothing ran.
 *     The caller may safely retry.
 *   * interference DURING the action → `user_interference_result_unknown`.
 *     Injection already went into the shared input stream and we cannot know
 *     how much of it landed, or where. Retrying could double-apply it.
 *
 * A foreground change during type/paste (no physical input) also reports
 * UNKNOWN — everything typed after it went somewhere unintended.
 */

import { GetForegroundWindow, GetWindowThreadProcessId } from '../win32/lib.js';
import { heldInputs } from '../input/inject.js';
import { InputMonitorUnavailable, PhysicalInputMonitor } from './monitor.js';

export class UserInterference extends Error {
  readonly code: string;
  constructor(message: string, code = 'user_interference') {
    super(message);
    this.name = 'UserInterference';
    this.code = code;
  }
}

/** Foreground window's owning pid, or null when unreadable. */
export function foregroundWindowPid(): number | null {
  const hwnd = GetForegroundWindow();
  if (!hwnd) return null;
  const pid = new Uint32Array(1);
  GetWindowThreadProcessId(hwnd, pid);
  return pid[0] ? pid[0]! : null;
}

export class ForegroundLease {
  private readonly monitor = new PhysicalInputMonitor();
  private readonly command: string;
  private epoch = 0;
  private pid: number | null = null;
  private closed = false;
  private actionStarted = false;

  constructor(command: string) {
    this.command = command;
  }

  /** Start monitoring and refuse up-front physical input / held keys. */
  acquire(): void {
    this.monitor.start();
    const before = this.monitor.snapshot();
    const held = heldInputs(this.command);
    this.pid = foregroundWindowPid();
    const after = this.monitor.snapshot();
    if (before !== after || held.length > 0) {
      this.close();
      const detail = held.length > 0 ? ` Held input: ${held.join(', ')}.` : '';
      throw new UserInterference(
        'The user was typing or moving the mouse, so the action was ' +
          'not sent. Nothing has changed; it is safe to try again.' +
          detail,
      );
    }
    this.epoch = after;
  }

  markStarted(): void {
    this.actionStarted = true;
  }

  /**
   * Verify the lease held for the whole action. MUST run before the success
   * response is written: once ok:true reaches the caller, no later discovery
   * can take that back (win_helper.py:1792-1805).
   */
  finalize(): void {
    let before: number;
    let pid: number | null;
    let after: number;
    try {
      before = this.monitor.snapshot();
      pid = foregroundWindowPid();
      after = this.monitor.snapshot();
    } catch (error) {
      if (error instanceof InputMonitorUnavailable) {
        throw new UserInterference(
          `${error.message}. Input was already sent, so the result is UNKNOWN; ` +
            'take a screenshot before continuing.',
          'user_interference_result_unknown',
        );
      }
      throw error;
    }

    if (before !== after || this.epoch !== after) {
      throw new UserInterference(
        'The user used the mouse or keyboard while this action was ' +
          'running. Because Windows shares one input stream between you ' +
          'and the user, the two may have interleaved and the result is ' +
          'UNKNOWN. Do not repeat the action — take a screenshot and ' +
          'read the current state before deciding anything.',
        'user_interference_result_unknown',
      );
    }

    // A foreground change without any physical input is the target app (or a
    // background app) stealing activation, not the user. Worth reporting,
    // because everything typed after it went somewhere unintended.
    if (
      (this.command === 'type' || this.command === 'paste_clipboard') &&
      this.pid !== null &&
      pid !== null &&
      this.pid !== pid
    ) {
      throw new UserInterference(
        'The foreground application changed while this action was ' +
          'running, so input may have gone to the wrong window. The ' +
          'result is UNKNOWN — take a screenshot before continuing.',
        'user_interference_result_unknown',
      );
    }
  }

  /** Stop monitoring. When the action already ran, failures are UNKNOWN. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.monitor.stop();
    } catch (error) {
      if (this.actionStarted) {
        if (error instanceof InputMonitorUnavailable) {
          throw new UserInterference(
            `${error.message}. Input was already sent, so the result is ` +
              'UNKNOWN; take a screenshot before continuing.',
            'user_interference_result_unknown',
          );
        }
        throw error;
      }
      throw error;
    }
  }
}
