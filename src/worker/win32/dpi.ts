/**
 * DPI awareness and display enumeration.
 *
 * DPI awareness must be forced at startup BEFORE any capture or coordinate
 * math: without per-monitor awareness, Windows virtualizes coordinates for
 * scaled displays and clicks land off by the scale factor. Three-level
 * fallback mirrors win_helper.py:50-71.
 *
 * Display enumeration uses EnumDisplayMonitorsW (device names like
 * "\\.\DISPLAY1") with GetDpiForMonitor for the per-display scale.
 */

import * as koffi from 'koffi';

import type { DisplayGeometry } from '../../core/types.js';
import {
  DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
  EnumDisplayMonitorsW,
  GetDpiForMonitor,
  GetMonitorInfoW,
  MDT_EFFECTIVE_DPI,
  MONITOR_DEFAULTTONEAREST,
  MONITORENUMPROC,
  MonitorFromPoint,
  SetProcessDPIAware,
  SetProcessDpiAwareness,
  SetProcessDpiAwarenessContext,
} from './lib.js';
import { MONITORINFOEXW } from './structs.js';

/**
 * Force per-monitor-v2 DPI awareness. Idempotent; safe to call once at worker
 * startup. Failures are non-fatal (a later level may have succeeded).
 */
export function enablePerMonitorDpiAwareness(): void {
  try {
    if (
      SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2)
    ) {
      return;
    }
  } catch {
    // fall through
  }
  try {
    const hr = SetProcessDpiAwareness(2);
    if (hr === 0 || hr === 0x80070005) {
      // S_OK, or E_ACCESSDENIED (already set at a coarser level).
      return;
    }
  } catch {
    // fall through
  }
  try {
    SetProcessDPIAware();
  } catch {
    // Nothing left to try; coordinates may be virtualized on scaled displays.
  }
}

/** Read a MONITORINFOEXW's device name as a JS string. */
function deviceName(info: Record<string, unknown>): string {
  const units = info.szDevice as number[];
  let end = units.indexOf(0);
  if (end === -1) end = units.length;
  return String.fromCharCode(...units.slice(0, end));
}

/** Enumerate every monitor with its physical geometry and DPI scale. */
export function listDisplays(): DisplayGeometry[] {
  const found: DisplayGeometry[] = [];
  const proc = koffi.register((hMonitor: bigint) => {
    const ptr = koffi.alloc(MONITORINFOEXW, 1);
    try {
      koffi.encode(ptr, MONITORINFOEXW, { cbSize: 40 + 64 });
      if (!GetMonitorInfoW(hMonitor, ptr)) return 1;
      const info = koffi.decode(ptr, MONITORINFOEXW) as {
        rcMonitor: {
          left: number;
          top: number;
          right: number;
          bottom: number;
        };
        dwFlags: number;
        szDevice: number[];
      };
      const rc = info.rcMonitor;
      const width = rc.right - rc.left;
      const height = rc.bottom - rc.top;
      // Scale from the monitor's center point; failure degrades to 1.0.
      let scaleFactor = 1;
      try {
        const centerX = rc.left + Math.floor(width / 2);
        const centerY = rc.top + Math.floor(height / 2);
        const near = MonitorFromPoint(
          centerX,
          centerY,
          MONITOR_DEFAULTTONEAREST,
        );
        const dpiX = new Uint32Array(1);
        const dpiY = new Uint32Array(1);
        if (
          near &&
          GetDpiForMonitor(near, MDT_EFFECTIVE_DPI, dpiX, dpiY) === 0
        ) {
          scaleFactor = Math.max(1.0, dpiX[0]! / 96.0);
        }
      } catch {
        scaleFactor = 1;
      }
      found.push({
        displayId: found.length,
        width,
        height,
        scaleFactor,
        originX: rc.left,
        originY: rc.top,
        label: deviceName(info),
        isPrimary: info.dwFlags !== 0, // MONITORINFOF_PRIMARY = 1
      });
      return 1;
    } finally {
      koffi.free(ptr);
    }
  }, koffi.pointer(MONITORENUMPROC));
  try {
    EnumDisplayMonitorsW(null, null, proc, 0);
  } finally {
    try {
      koffi.unregister(proc);
    } catch {
      // harmless
    }
  }
  if (found.length === 0) {
    throw new Error('no active displays found');
  }
  return found;
}

/** Pick a display by id, or the primary one when id is undefined. */
export function chooseDisplay(
  displays: DisplayGeometry[],
  displayId?: number,
): DisplayGeometry {
  if (displayId === undefined) {
    const primary = displays.find((d) => d.isPrimary);
    return primary ?? displays[0]!;
  }
  const found = displays.find((d) => d.displayId === displayId);
  if (!found) throw new Error(`unknown display: ${displayId}`);
  return found;
}
