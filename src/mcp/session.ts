/**
 * Session state: the per-server cross-call memory every handler reads.
 *
 * Mirrors the closure-cell state cc-haha keeps in serverDef.ts: the last
 * screenshot (for coordinate transforms and pixelCompare), the selected
 * display, and the left-button hold ledger with its generation + pending
 * dedup (windowsLegacyToolCalls.ts:467-530).
 */

import type { ScreenshotResult } from '../core/types.js';

/**
 * Internal binder identity. Carried in-process only, never on the wire, so a
 * cancelled session cannot release another session's synthetic mouse press.
 */
const MOUSE_OWNER = Symbol('computerUseMouseOwner');

export interface MouseOwner {
  canRelease(): boolean;
}

export interface SessionState {
  /** The screenshot the model's coordinates are relative to. */
  lastScreenshot: ScreenshotResult | undefined;
  /** Explicit switch_display pin, or undefined for automatic resolution. */
  selectedDisplayId: number | undefined;
  /** Whether the display is pinned (controls the switch hint in notes). */
  displayPinnedByModel: boolean;
  /** The display of the last screenshot (change detection for notes). */
  lastDisplayId: number | undefined;
  /** App-set key the display was auto-resolved for. */
  displayResolvedForApps: string | undefined;
}

export function createSessionState(): SessionState {
  return {
    lastScreenshot: undefined,
    selectedDisplayId: undefined,
    displayPinnedByModel: false,
    lastDisplayId: undefined,
    displayResolvedForApps: undefined,
  };
}

/**
 * Left-button hold ledger.
 *
 * A held button must survive across tool calls, so it lives here rather than
 * in the worker. The generation counter plus the pending-release map keep
 * concurrent release attempts from double-sending mouse_up; the owner check
 * keeps a cancelled session from releasing a press it does not own.
 */
export class MouseHoldLedger {
  private held = false;
  private owner: MouseOwner | undefined;
  private generation = 0;
  private pending:
    { generation: number; promise: Promise<boolean> } | undefined;

  get isHeld(): boolean {
    return this.held;
  }

  /** Mark a press as held by `owner`. */
  press(owner: MouseOwner): void {
    this.held = true;
    this.owner = owner;
    this.generation += 1;
  }

  /** Clear the ledger without touching the OS (owner change, failed release). */
  clear(): void {
    this.held = false;
    this.owner = undefined;
    this.generation += 1;
  }

  hasHeldFor(owner: MouseOwner): boolean {
    return this.held && this.owner === owner;
  }

  /**
   * Release a held press, re-checking ownership right before the worker call
   * (the ownership check can yield, and a new lock holder may reset state
   * while it is in flight). Returns whether a release was actually sent.
   */
  async release(
    owner: MouseOwner | undefined,
    release: () => Promise<void>,
  ): Promise<boolean> {
    if (!this.held || (owner !== undefined && this.owner !== owner)) {
      return false;
    }
    const generation = this.generation;
    if (this.pending?.generation === generation) {
      return this.pending.promise;
    }
    const promise = (async () => {
      if (owner && !owner.canRelease()) return false;
      if (!this.held || this.generation !== generation) return false;
      if (owner && this.owner !== owner) return false;
      await release();
      if (this.generation === generation) this.clear();
      return true;
    })();
    this.pending = { generation, promise };
    try {
      return await promise;
    } finally {
      if (this.pending?.promise === promise) this.pending = undefined;
    }
  }
}

/** The in-process owner token for this server's synthetic presses. */
export const sessionMouseOwner: MouseOwner = {
  canRelease: () => true,
};

export { MOUSE_OWNER };
