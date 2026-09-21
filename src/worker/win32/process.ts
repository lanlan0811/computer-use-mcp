/**
 * Process handles for exe-path queries.
 *
 * cc-haha uses psutil; this project queries the process image name directly
 * through kernel32, so no process-walking dependency is needed.
 */

import { CloseHandle, OpenProcess, QueryFullProcessImageNameW } from './lib.js';

/** PROCESS_QUERY_LIMITED_INFORMATION — enough for the image name. */
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

export function openProcess(pid: number): bigint | null {
  // (dwDesiredAccess, bInheritHandle, dwProcessId)
  const handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
  return handle ?? null;
}

export function closeProcessHandle(handle: bigint): void {
  CloseHandle(handle);
}

/** Full image path of a process, or null when unreadable. */
export function processExePath(pid: number): string | null {
  const handle = openProcess(pid);
  if (!handle) return null;
  try {
    const size = new Uint32Array(1);
    size[0] = 1024;
    const buffer = new Uint16Array(1024);
    if (!QueryFullProcessImageNameW(handle, 0, buffer, size)) return null;
    return String.fromCharCode(...buffer.subarray(0, size[0]!));
  } finally {
    closeProcessHandle(handle);
  }
}
