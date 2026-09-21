/**
 * Delivery preconditions: refuse rather than report a lie.
 *
 * `SendInput` always "succeeds" — it returns the number of events inserted
 * into the input stream, never whether anything acted on them. Click behind
 * another window and the click lands on THAT window; click off-screen and it
 * lands nowhere. Either way the helper would answer "Action completed".
 * That is the exact lie these guards exist to prevent (win_helper.py:1488-1654).
 *
 * Both guards fail OPEN when system state is unreadable: an unreadable metric
 * is our problem, not the caller's, and blocking every action on it would be
 * worse than the miss it prevents.
 */

import * as koffi from 'koffi';

import {
  ENUMPROC,
  EnumWindows,
  GetSystemMetrics,
  GetWindowPlacement,
  GetWindowRect,
  IsWindow,
  IsWindowVisible,
  SM_CXVIRTUALSCREEN,
  SM_XVIRTUALSCREEN,
  SM_CYVIRTUALSCREEN,
  SM_YVIRTUALSCREEN,
  SW_SHOWMINIMIZED,
} from '../win32/lib.js';
import { RECT, WINDOWPLACEMENT } from '../win32/structs.js';
import { exeName, exeStem, windowProcess } from '../windows/apps.js';

export class DeliveryRefused extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'DeliveryRefused';
    this.code = code;
  }
}

interface ScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Window rect, or null when the call fails (not the same as "unreadable"). */
function readWindowRect(hwnd: bigint): ScreenRect | null {
  const ptr = koffi.alloc(RECT, 1);
  try {
    if (!GetWindowRect(hwnd, ptr)) return null;
    return koffi.decode(ptr, RECT) as ScreenRect;
  } finally {
    koffi.free(ptr);
  }
}

/** (left, top, right, bottom) across all monitors, or null if unavailable. */
function virtualScreenRect(): ScreenRect | null {
  try {
    const left = GetSystemMetrics(SM_XVIRTUALSCREEN);
    const top = GetSystemMetrics(SM_YVIRTUALSCREEN);
    const width = GetSystemMetrics(SM_CXVIRTUALSCREEN);
    const height = GetSystemMetrics(SM_CYVIRTUALSCREEN);
    if (width <= 0 || height <= 0) return null;
    return { left, top, right: left + width, bottom: top + height };
  } catch {
    return null;
  }
}

/** Refuse coordinates outside every monitor. Fails open when unreadable. */
export function ensurePointOnScreen(x: number, y: number): void {
  const rect = virtualScreenRect();
  if (rect === null) return;
  if (rect.left <= x && x < rect.right && rect.top <= y && y < rect.bottom) {
    return;
  }
  throw new DeliveryRefused(
    `The point (${x}, ${y}) is outside every display (virtual screen is ` +
      `${rect.left},${rect.top} to ${rect.right},${rect.bottom}), so the action ` +
      'was not sent. Take a screenshot to get current coordinates.',
    'point_outside_display',
  );
}

/** (ok, reason) — whether synthetic input can reach this window at all. */
function windowIsInteractable(hwnd: bigint): { ok: boolean; reason: string } {
  try {
    if (!IsWindow(hwnd)) {
      return { ok: false, reason: 'the window no longer exists' };
    }
    if (!IsWindowVisible(hwnd)) {
      return { ok: false, reason: 'the window is hidden' };
    }
    try {
      const placementPtr = koffi.alloc(WINDOWPLACEMENT, 1);
      try {
        koffi.encode(placementPtr, WINDOWPLACEMENT, { length: 44 });
        GetWindowPlacement(hwnd, placementPtr);
        const placement = koffi.decode(placementPtr, WINDOWPLACEMENT) as {
          showCmd: number;
        };
        if (placement.showCmd === SW_SHOWMINIMIZED) {
          return { ok: false, reason: 'the window is minimized' };
        }
      } finally {
        koffi.free(placementPtr);
      }
    } catch {
      // unreadable placement fails open below
    }
    const rect = readWindowRect(hwnd);
    if (
      rect !== null &&
      (rect.right - rect.left <= 0 || rect.bottom - rect.top <= 0)
    ) {
      return { ok: false, reason: 'the window has no on-screen area' };
    }
    return { ok: true, reason: '' };
  } catch {
    // Unreadable window state fails open, same reasoning as the metrics.
    return { ok: true, reason: '' };
  }
}

/**
 * Every top-level HWND owned by a process whose exe stem matches.
 *
 * Enumerates directly rather than reusing listWindows(), which filters out
 * invisible and zero-area windows — precisely the states this guard needs to
 * SEE in order to refuse (win_helper.py:1570-1619).
 */
function windowsForBundle(bundleId: string): bigint[] {
  const wanted = bundleId.trim().toLowerCase();
  if (!wanted) return [];
  const handles: bigint[] = [];
  const proc = koffi.register((hwnd: bigint) => {
    try {
      const process = windowProcess(hwnd);
      if (!process) return 1;
      const candidates = new Set([
        exeStem(process.exePath).toLowerCase(),
        exeName(process.exePath).toLowerCase(),
      ]);
      if (candidates.has(wanted)) handles.push(hwnd);
    } catch {
      // skip unreadable windows
    }
    return 1;
  }, koffi.pointer(ENUMPROC));
  try {
    EnumWindows(proc, 0);
  } finally {
    try {
      koffi.unregister(proc);
    } catch {
      // harmless
    }
  }
  return handles;
}

/**
 * Refuse when the named app has no window that input could reach.
 *
 * A minimized window is the case that matters: on Windows it has no client
 * area to hit-test against, so a coordinate click is guaranteed to land on
 * whatever is underneath it. Fails OPEN when the app owns no top-level
 * windows at all — that is a different failure (wrong app name, app not
 * running) which the caller's own resolution step reports better.
 */
export function ensureTargetWindowReachable(bundleId: string | null): void {
  if (!bundleId) return;
  const handles = windowsForBundle(bundleId);
  if (handles.length === 0) return;
  const reasons: string[] = [];
  for (const hwnd of handles) {
    const { ok, reason } = windowIsInteractable(hwnd);
    if (ok) return;
    if (reason) reasons.push(reason);
  }
  const detail = reasons[0] ?? 'it has no on-screen window';
  throw new DeliveryRefused(
    `The target app has no window that input can reach — ${detail}. ` +
      'The action was NOT sent. Restore the window and try again.',
    'target_window_offscreen',
  );
}

/** Exported for tests. */
export const _test = {
  virtualScreenRect,
  windowIsInteractable,
  windowsForBundle,
};
