/**
 * Window and application enumeration.
 *
 * Ports win_helper.py:297-720 to koffi: EnumWindows with a registered
 * callback, process identity via GetWindowThreadProcessId +
 * QueryFullProcessImageNameW (no psutil), UWP ApplicationFrameHost
 * resolution, the three uninstall registry hives, and the foreground reuse
 * path for open_app.
 */

import * as koffi from 'koffi';

import {
  ENUMPROC,
  EnumChildWindows,
  EnumWindows,
  GA_ROOTOWNER,
  GetAncestor,
  GetClassNameW,
  GetForegroundWindow,
  GetWindowRect,
  GetWindowTextLengthW,
  GetWindowTextW,
  GetWindowThreadProcessId,
  IsIconic,
  IsWindowVisible,
  KEY_READ,
  HKEY_CURRENT_USER,
  HKEY_LOCAL_MACHINE,
  ERROR_NO_MORE_ITEMS,
  RegCloseKey,
  RegEnumKeyExW,
  RegOpenKeyExW,
  RegQueryValueExW,
  SetForegroundWindow,
  ShellExecuteW,
  ShowWindow,
  SW_RESTORE,
  WindowFromPoint,
  GetFileAttributesW,
  INVALID_HANDLE_VALUE,
  SW_SHOWNORMAL,
} from '../win32/lib.js';
import { processExePath } from '../win32/process.js';
import { RECT } from '../win32/structs.js';

export interface InstalledApp {
  bundleId: string;
  displayName: string;
  path: string;
}

export interface WindowInfo {
  ownerName: string;
  title: string;
  bounds: { x: number; y: number; width: number; height: number };
}

/** Enumerate top-level windows with a callback; returns collected items. */
function enumWindows<T>(collect: (hwnd: bigint) => T | undefined): T[] {
  const results: T[] = [];
  const proc = koffi.register((hwnd: bigint) => {
    const value = collect(hwnd);
    if (value !== undefined) results.push(value);
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
  return results;
}

/** Enumerate child windows of hwnd. */
function enumChildWindows<T>(
  hwnd: bigint,
  collect: (child: bigint) => T | undefined,
): T[] {
  const results: T[] = [];
  const proc = koffi.register((child: bigint) => {
    const value = collect(child);
    if (value !== undefined) results.push(value);
    return 1;
  }, koffi.pointer(ENUMPROC));
  try {
    EnumChildWindows(hwnd, proc, 0);
  } finally {
    try {
      koffi.unregister(proc);
    } catch {
      // harmless
    }
  }
  return results;
}

/** Read a window title (UTF-16). */
export function windowTitle(hwnd: bigint): string {
  const length = GetWindowTextLengthW(hwnd);
  if (length <= 0) return '';
  const buffer = new Uint16Array(length + 1);
  const copied = GetWindowTextW(hwnd, buffer, length + 1);
  return String.fromCharCode(...buffer.subarray(0, Math.max(copied, 0)));
}

/** Read a window class name (UTF-16). */
export function windowClassName(hwnd: bigint): string {
  const buffer = new Uint16Array(256);
  const copied = GetClassNameW(hwnd, buffer, 256);
  return String.fromCharCode(...buffer.subarray(0, Math.max(copied, 0)));
}

/** Owning process id of a window. */
function windowProcessId(hwnd: bigint): number | null {
  const pid = new Uint32Array(1);
  GetWindowThreadProcessId(hwnd, pid);
  return pid[0] ? pid[0]! : null;
}

export interface ResolvedProcess {
  pid: number;
  exePath: string;
}

/**
 * Resolve the application process represented by a top-level HWND.
 *
 * Packaged/UWP apps are hosted by ApplicationFrameHost.exe: the visible
 * top-level window belongs to the host while a CoreWindow child belongs to
 * the real app (e.g. CalculatorApp.exe). Treating the host as the app makes
 * an already visible packaged app look uninstalled and breaks the foreground
 * allowlist check (win_helper.py:347-383).
 */
export function windowProcess(hwnd: bigint): ResolvedProcess | null {
  const hostPid = windowProcessId(hwnd);
  if (hostPid === null) return null;
  const hostExe = processExePath(hostPid);
  if (hostExe === null) return null;
  if (!exeStem(hostExe).toLowerCase().endsWith('applicationframehost')) {
    return { pid: hostPid, exePath: hostExe };
  }

  const candidates: Array<{ priority: number; pid: number; exePath: string }> =
    [];
  for (const child of enumChildWindows(hwnd, (childHwnd) => {
    const childPid = windowProcessId(childHwnd);
    if (childPid === null || childPid === hostPid) return undefined;
    const childExe = processExePath(childPid);
    if (!childExe) return undefined;
    const priority =
      windowClassName(childHwnd) === 'Windows.UI.Core.CoreWindow' ? 0 : 1;
    return { priority, pid: childPid, exePath: childExe };
  })) {
    candidates.push(child);
  }
  if (candidates.length === 0) {
    return { pid: hostPid, exePath: hostExe };
  }
  candidates.sort((a, b) => a.priority - b.priority);
  const best = candidates[0]!;
  return { pid: best.pid, exePath: best.exePath };
}

/** "C:\Program Files\Foo\Bar.exe" → "Bar". */
export function exeStem(exePath: string): string {
  const cleaned = exePath.replace(/\\/g, '/');
  const file = cleaned.slice(cleaned.lastIndexOf('/') + 1);
  const dot = file.lastIndexOf('.');
  return dot > 0 ? file.slice(0, dot) : file;
}

/** File name with extension: "C:\...\Bar.exe" → "Bar.exe". */
export function exeName(exePath: string): string {
  const cleaned = exePath.replace(/\\/g, '/');
  return cleaned.slice(cleaned.lastIndexOf('/') + 1);
}

/** Visible, titled top-level windows (list_windows). */
export function listWindows(): WindowInfo[] {
  return enumWindows<WindowInfo>((hwnd) => {
    if (!IsWindowVisible(hwnd)) return undefined;
    const title = windowTitle(hwnd);
    if (title.trim() === '') return undefined;
    const rect = windowRect(hwnd);
    if (!rect) return undefined;
    const width = rect.right - rect.left;
    const height = rect.bottom - rect.top;
    if (width <= 1 || height <= 1) return undefined;
    const process = windowProcess(hwnd);
    return {
      ownerName: process ? exeName(process.exePath) : '',
      title,
      bounds: { x: rect.left, y: rect.top, width, height },
    };
  });
}

interface ScreenRectShape {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Window rect in screen coordinates, or null when unreadable. */
function readWindowRect(hwnd: bigint): ScreenRectShape | null {
  const ptr = koffi.alloc(RECT, 1);
  try {
    if (!GetWindowRect(hwnd, ptr)) return null;
    return koffi.decode(ptr, RECT) as ScreenRectShape;
  } finally {
    koffi.free(ptr);
  }
}

function windowRect(hwnd: bigint): ScreenRectShape | null {
  return readWindowRect(hwnd);
}

/** Currently visible GUI applications with a titled top-level window. */
export function visibleGuiApps(): InstalledApp[] {
  const results = new Map<string, InstalledApp>();
  enumWindows((hwnd) => {
    if (!IsWindowVisible(hwnd)) return;
    if (windowTitle(hwnd).trim() === '') return;
    const rect = windowRect(hwnd);
    if (!rect || rect.right - rect.left <= 1 || rect.bottom - rect.top <= 1) {
      return;
    }
    const process = windowProcess(hwnd);
    if (!process) return;
    const bundleId = exeStem(process.exePath);
    if (!bundleId) return;
    const key = bundleId.toLowerCase();
    if (!results.has(key)) {
      results.set(key, {
        bundleId,
        displayName: exeName(process.exePath),
        path: process.exePath,
      });
    }
    return undefined;
  });
  return [...results.values()].sort((a, b) =>
    a.displayName.toLowerCase().localeCompare(b.displayName.toLowerCase()),
  );
}

/** Registry uninstall entries across the three hives (win_helper.py:427-499). */
function registryApps(): InstalledApp[] {
  const results = new Map<string, InstalledApp>();
  const hives: Array<[bigint, string]> = [
    [
      HKEY_LOCAL_MACHINE,
      'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    ],
    [
      HKEY_LOCAL_MACHINE,
      'SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    ],
    [
      HKEY_CURRENT_USER,
      'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    ],
  ];
  for (const [hive, subKey] of hives) {
    const key = new BigUint64Array(1);
    if (RegOpenKeyExW(hive, subKey, 0, KEY_READ, key) !== 0) continue;
    const hKey = key[0]!;
    try {
      let index = 0;
      for (;;) {
        const nameBuffer = new Uint16Array(256);
        const nameLength = new Uint32Array(1);
        nameLength[0] = 256;
        const status = RegEnumKeyExW(
          hKey,
          index,
          nameBuffer,
          nameLength,
          null,
          null,
          null,
          null,
        );
        if (status === ERROR_NO_MORE_ITEMS) break;
        if (status !== 0) break;
        index += 1;
        const name = String.fromCharCode(
          ...nameBuffer.subarray(0, nameLength[0]!),
        );
        const appKey = new BigUint64Array(1);
        if (RegOpenKeyExW(hKey, name, 0, KEY_READ, appKey) !== 0) continue;
        try {
          const displayName = readRegString(appKey[0]!, 'DisplayName');
          if (displayName === null) continue;
          const installLocation =
            readRegString(appKey[0]!, 'InstallLocation') ?? '';
          const displayIcon = readRegString(appKey[0]!, 'DisplayIcon') ?? '';
          const normalizedIcon = displayIcon
            .split(',')[0]!
            .trim()
            .replace(/^"|"$/g, '');
          const normalizedInstall = installLocation
            .trim()
            .replace(/^"|"$/g, '');

          let bundleId = name;
          for (const candidate of [normalizedIcon, normalizedInstall]) {
            if (!candidate) continue;
            if (candidate.toLowerCase().endsWith('.exe')) {
              bundleId = exeStem(candidate);
              break;
            }
          }
          if (!results.has(bundleId)) {
            results.set(bundleId, {
              bundleId,
              displayName,
              path: normalizedIcon || normalizedInstall || '',
            });
          }
        } finally {
          RegCloseKey(appKey[0]!);
        }
      }
    } finally {
      RegCloseKey(hKey);
    }
  }
  return [...results.values()];
}

/** Read one REG_SZ value; null when missing or not a string. */
function readRegString(hKey: bigint, valueName: string): string | null {
  const type = new Uint32Array(1);
  const size = new Uint32Array(1);
  const status = RegQueryValueExW(hKey, valueName, null, type, null, size);
  if (status !== 0 || size[0] === 0) return null;
  const buffer = new Uint16Array(Math.ceil(size[0]! / 2) + 1);
  const status2 = RegQueryValueExW(hKey, valueName, null, type, buffer, size);
  if (status2 !== 0) return null;
  const units = Math.max(0, Math.floor(size[0]! / 2) - 1);
  return String.fromCharCode(...buffer.subarray(0, units));
}

let appCache: { at: number; apps: InstalledApp[] } | null = null;

/** Registry + visible GUI apps, TTL-cached (plan decision 11). */
export function installedApps(ttlMs: number): InstalledApp[] {
  const now = Date.now();
  if (appCache && now - appCache.at < ttlMs) return appCache.apps;
  const results = new Map<string, InstalledApp>();
  for (const app of registryApps()) results.set(app.bundleId, app);
  const existing = new Set([...results.keys()].map((k) => k.toLowerCase()));
  for (const app of visibleGuiApps()) {
    if (existing.has(app.bundleId.toLowerCase())) continue;
    results.set(app.bundleId, app);
    existing.add(app.bundleId.toLowerCase());
  }
  const apps = [...results.values()].sort((a, b) =>
    a.displayName.toLowerCase().localeCompare(b.displayName.toLowerCase()),
  );
  appCache = { at: now, apps };
  return apps;
}

/** Foreground application identity, or null when it cannot be determined. */
export function frontmostApp(): InstalledApp | null {
  const hwnd = GetForegroundWindow();
  if (!hwnd) return null;
  const process = windowProcess(hwnd);
  if (!process) return null;
  return {
    bundleId: exeStem(process.exePath),
    displayName: exeName(process.exePath),
    path: process.exePath,
  };
}

/** Application under a screen coordinate (top-level owner resolved). */
export function appUnderPoint(x: number, y: number): InstalledApp | null {
  const hwnd = WindowFromPoint(x, y);
  if (!hwnd) return frontmostApp();
  const root = GetAncestor(hwnd, GA_ROOTOWNER);
  const target = root ?? hwnd;
  const process = windowProcess(target);
  if (!process) return frontmostApp();
  return {
    bundleId: exeStem(process.exePath),
    displayName: exeName(process.exePath),
    path: process.exePath,
  };
}

/** Bring the frontmost matching visible window forward, if one exists. */
export function foregroundExistingApp(bundleId: string): boolean {
  const wanted = bundleId.trim().toLowerCase();
  if (!wanted) return false;
  const matches = enumWindows<bigint>((hwnd) => {
    if (!IsWindowVisible(hwnd)) return undefined;
    if (windowTitle(hwnd).trim() === '') return undefined;
    const process = windowProcess(hwnd);
    if (!process) return undefined;
    const candidates = new Set([
      exeStem(process.exePath).toLowerCase(),
      exeName(process.exePath).toLowerCase(),
    ]);
    return candidates.has(wanted) ? hwnd : undefined;
  });
  if (matches.length === 0) return false;
  const hwnd = matches[0]!;
  if (IsIconic(hwnd)) ShowWindow(hwnd, SW_RESTORE);
  SetForegroundWindow(hwnd);
  return true;
}

/** Open an app: foreground reuse, then registry exe, then shell fallback. */
export function openApp(bundleId: string): void {
  if (foregroundExistingApp(bundleId)) return;
  const exePath = findRegistryExe(bundleId);
  if (exePath && fileExists(exePath)) {
    ShellExecuteW(null, 'open', exePath, null, null, SW_SHOWNORMAL);
    return;
  }
  ShellExecuteW(null, 'open', bundleId, null, null, SW_SHOWNORMAL);
}

function fileExists(path: string): boolean {
  const attributes = GetFileAttributesW(path);
  return attributes !== INVALID_HANDLE_VALUE && attributes !== 0xffffffff;
}

/** Search the uninstall registry for an exe path matching a bundle id. */
function findRegistryExe(bundleId: string): string | null {
  const hives: Array<[bigint, string]> = [
    [
      HKEY_LOCAL_MACHINE,
      'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    ],
    [
      HKEY_LOCAL_MACHINE,
      'SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    ],
    [
      HKEY_CURRENT_USER,
      'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    ],
  ];
  for (const [hive, subKey] of hives) {
    const key = new BigUint64Array(1);
    if (RegOpenKeyExW(hive, subKey, 0, KEY_READ, key) !== 0) continue;
    const hKey = key[0]!;
    try {
      let index = 0;
      for (;;) {
        const nameBuffer = new Uint16Array(256);
        const nameLength = new Uint32Array(1);
        nameLength[0] = 256;
        const status = RegEnumKeyExW(
          hKey,
          index,
          nameBuffer,
          nameLength,
          null,
          null,
          null,
          null,
        );
        if (status !== 0) break;
        index += 1;
        const name = String.fromCharCode(
          ...nameBuffer.subarray(0, nameLength[0]!),
        );
        const appKey = new BigUint64Array(1);
        if (RegOpenKeyExW(hKey, name, 0, KEY_READ, appKey) !== 0) continue;
        try {
          const displayIcon = readRegString(appKey[0]!, 'DisplayIcon') ?? '';
          const installLocation =
            readRegString(appKey[0]!, 'InstallLocation') ?? '';
          const normalizedIcon = displayIcon
            .split(',')[0]!
            .trim()
            .replace(/^"|"$/g, '');
          const normalizedInstall = installLocation
            .trim()
            .replace(/^"|"$/g, '');
          let derived = name;
          for (const candidate of [normalizedIcon, normalizedInstall]) {
            if (!candidate) continue;
            if (candidate.toLowerCase().endsWith('.exe')) {
              derived = exeStem(candidate);
              break;
            }
          }
          if (name === bundleId || derived === bundleId) {
            return normalizedIcon || normalizedInstall || null;
          }
        } finally {
          RegCloseKey(appKey[0]!);
        }
      }
    } finally {
      RegCloseKey(hKey);
    }
  }
  return null;
}
