/**
 * Action dispatch: the worker-side half of every tool call.
 *
 * Mirrors win_helper.py's main() ordering exactly — the mutating-command set
 * is kept as one table rather than a guard inside each branch, because the
 * branches are the easy place to forget one, and a forgotten branch is
 * silently unguarded (win_helper.py:1766-1771).
 *
 * Ordering per mutating action:
 *   1. delivery pre-checks (point on screen, target window reachable)
 *   2. lease acquire (refuses up-front physical input)
 *   3. execute
 *   4. lease finalize BEFORE the success response is written
 */

import { config } from '../core/config.js';
import { API_RESIZE_PARAMS, targetImageSize } from '../core/imageBudget.js';
import { captureDisplay, captureRegion } from './capture/screen.js';
import { readClipboard, writeClipboard } from './clipboard/clipboard.js';
import {
  DeliveryRefused,
  ensurePointOnScreen,
  ensureTargetWindowReachable,
} from './guards/delivery.js';
import { click, drag, holdKeys, keyAction, scroll } from './input/actions.js';
import {
  leftButtonEvent,
  moveCursorTo,
  pasteClipboard,
  readCursorPos,
  sendInputs,
  typeText,
} from './input/inject.js';
import { ForegroundLease, UserInterference } from './lease/lease.js';
import { InputMonitorUnavailable } from './lease/monitor.js';
import { chooseDisplay, listDisplays } from './win32/dpi.js';
import {
  appUnderPoint,
  frontmostApp,
  installedApps,
  listWindows,
  openApp,
} from './windows/apps.js';

/** Commands that inject into the shared Windows input stream. */
export const MUTATING_COMMANDS: ReadonlySet<string> = new Set([
  'click',
  'drag',
  'move_mouse',
  'scroll',
  'mouse_down',
  'mouse_up',
  'key',
  'hold_key',
  'type',
  'paste_clipboard',
]);

/** The subset that targets a screen coordinate. */
export const COORDINATE_COMMANDS: ReadonlySet<string> = new Set([
  'click',
  'drag',
  'move_mouse',
  'scroll',
]);

interface Point {
  x: number;
  y: number;
}

/** Extract the coordinate a command targets, if any. */
export function coordinateOf(
  command: string,
  payload: Record<string, unknown>,
): Point | null {
  if (!COORDINATE_COMMANDS.has(command)) return null;
  if (command === 'drag') {
    const target = payload.to as Point | undefined;
    if (
      target &&
      typeof target.x === 'number' &&
      typeof target.y === 'number'
    ) {
      return { x: target.x, y: target.y };
    }
    return null;
  }
  if (typeof payload.x === 'number' && typeof payload.y === 'number') {
    return { x: payload.x, y: payload.y };
  }
  return null;
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export interface ActionResult {
  result: unknown;
}

/**
 * Execute one action. Errors are thrown as typed exceptions; the entry point
 * maps them to protocol error codes.
 */
export async function executeAction(
  action: string,
  payload: Record<string, unknown> = {},
): Promise<unknown> {
  let lease: ForegroundLease | null = null;
  try {
    if (MUTATING_COMMANDS.has(action)) {
      const point = coordinateOf(action, payload);
      if (point !== null) ensurePointOnScreen(point.x, point.y);
      const target = (payload.bundleId ?? payload.app) as string | undefined;
      ensureTargetWindowReachable(target ?? null);
      lease = new ForegroundLease(action);
      lease.acquire();
      lease.markStarted();
    }

    switch (action) {
      case 'ping':
        return { pong: true };

      case 'check_permissions':
        // Windows has no TCC equivalent; always granted (win_helper.py:1479-1485).
        return { accessibility: true, screenRecording: true };

      case 'list_displays':
        return listDisplays();

      case 'get_display_size':
        return chooseDisplay(
          listDisplays(),
          payload.displayId as number | undefined,
        );

      case 'screenshot': {
        const displays = listDisplays();
        const display = chooseDisplay(
          displays,
          payload.displayId as number | undefined,
        );
        const target = budgetTarget(display.width, display.height);
        return captureDisplay(display.displayId, target);
      }

      case 'zoom': {
        const region = {
          x: num(payload.x, 0),
          y: num(payload.y, 0),
          width: num(payload.width, 0),
          height: num(payload.height, 0),
        };
        return captureRegion(region, {});
      }

      case 'cursor_position': {
        const point = readCursorPos();
        if (point === null) throw new Error('GetCursorPos failed');
        return { x: point.x, y: point.y };
      }

      case 'frontmost_app':
        return frontmostApp();

      case 'app_under_point':
        return appUnderPoint(num(payload.x, 0), num(payload.y, 0));

      case 'list_installed_apps':
        return installedApps(config.appCacheTtlMs);

      case 'list_windows':
        return listWindows();

      case 'open_app':
        openApp(String(payload.bundleId ?? ''));
        return true;

      case 'read_clipboard':
        return readClipboard();

      case 'write_clipboard':
        writeClipboard(String(payload.text ?? ''));
        return true;

      case 'click':
        click(
          num(payload.x, 0),
          num(payload.y, 0),
          (payload.button as 'left' | 'right' | 'middle') ?? 'left',
          num(payload.count, 1),
          payload.modifiers as string[] | undefined,
          payload.animate !== false,
        );
        return finish(lease);

      case 'drag': {
        const from = payload.from as Point | undefined;
        const to = payload.to as Point;
        drag(from, to, payload.animate !== false);
        return finish(lease);
      }

      case 'move_mouse':
        moveCursorTo(
          num(payload.x, 0),
          num(payload.y, 0),
          payload.animate !== false,
        );
        return finish(lease);

      case 'scroll':
        scroll(
          num(payload.x, 0),
          num(payload.y, 0),
          num(payload.deltaX, 0),
          num(payload.deltaY, 0),
          payload.animate !== false,
        );
        return finish(lease);

      case 'key':
        keyAction(String(payload.keySequence ?? ''), num(payload.repeat, 1));
        return finish(lease);

      case 'hold_key':
        holdKeys(
          (payload.keyNames as string[] | undefined) ?? [],
          num(payload.durationMs, 0),
        );
        return finish(lease);

      case 'type':
        typeText(String(payload.text ?? ''), config.typeCharDelayMs);
        return finish(lease);

      case 'paste_clipboard':
        pasteClipboard();
        return finish(lease);

      case 'mouse_down':
        sendInputs([leftButtonEvent(true)]);
        return finish(lease);

      case 'mouse_up':
        sendInputs([leftButtonEvent(false)]);
        return finish(lease);

      default:
        throw new UnknownActionError(action);
    }
  } catch (error) {
    // Preserve the first machine-readable error while still cleaning up.
    if (lease !== null) {
      try {
        lease.close();
      } catch (cleanupError) {
        if (
          cleanupError instanceof UserInterference &&
          !(error instanceof UserInterference) &&
          !(error instanceof DeliveryRefused) &&
          !(error instanceof InputMonitorUnavailable)
        ) {
          throw cleanupError;
        }
      }
    }
    throw error;
  }
}

/**
 * Finalize the lease BEFORE returning success. The check runs before the
 * response is written, and that ordering is the whole point: once ok:true
 * reaches the caller the action is reported as done, and no later discovery
 * can take that back (win_helper.py:1792-1805).
 */
function finish(lease: ForegroundLease | null): unknown {
  if (lease !== null) {
    lease.finalize();
    lease.close();
  }
  return true;
}

/** Image-budget target for a display, or undefined when it already fits. */
function budgetTarget(
  displayWidth: number,
  displayHeight: number,
): { targetWidth: number; targetHeight: number } | undefined {
  const [width, height] = targetImageSize(
    displayWidth,
    displayHeight,
    API_RESIZE_PARAMS,
  );
  if (width === displayWidth && height === displayHeight) return undefined;
  return { targetWidth: width, targetHeight: height };
}

export class UnknownActionError extends Error {
  constructor(action: string) {
    super(`unknown action: ${action}`);
    this.name = 'UnknownActionError';
  }
}

/** Map a thrown error to its machine-readable worker error code. */
export function errorCodeOf(error: unknown): string {
  if (error instanceof UserInterference) return error.code;
  if (error instanceof DeliveryRefused) return error.code;
  if (error instanceof InputMonitorUnavailable) {
    return 'input_monitor_unavailable';
  }
  if (error instanceof UnknownActionError) return 'bad_args';
  // InputInjectionError and any other coded failure carry their own code.
  if (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string'
  ) {
    return (error as { code: string }).code;
  }
  return 'worker_internal';
}

/** Commands and code paths exported for the contract tests. */
export const _test = {
  MUTATING_COMMANDS,
  COORDINATE_COMMANDS,
  coordinateOf,
  budgetTarget,
  errorCodeOf,
};
