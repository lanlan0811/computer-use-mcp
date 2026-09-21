/**
 * Clipboard read/write through the Win32 clipboard API (CF_UNICODETEXT).
 *
 * cc-haha uses pyperclip; this project calls the API directly with koffi so
 * there is no external interpreter anywhere in the stack (plan §4).
 * `clipboardy` was rejected for the same reason — it shells out to
 * PowerShell.
 */

import * as koffi from 'koffi';

import {
  CF_UNICODETEXT,
  CloseClipboard,
  EmptyClipboard,
  GetClipboardData,
  GlobalAlloc,
  GlobalFree,
  GlobalLock,
  GlobalUnlock,
  GMEM_MOVEABLE,
  IsClipboardFormatAvailable,
  OpenClipboard,
  SetClipboardData,
} from '../win32/lib.js';

const utf16CodeUnits = (text: string): Buffer => Buffer.from(text, 'utf16le');

/** Read the clipboard as text. Empty string when unavailable or non-text. */
export function readClipboard(): string {
  if (!IsClipboardFormatAvailable(CF_UNICODETEXT)) return '';
  // OpenClipboard can fail while another process holds the clipboard; retry
  // a few times like the classic implementation does.
  let opened = false;
  for (let attempt = 0; attempt < 5 && !opened; attempt += 1) {
    opened = !!OpenClipboard(null);
    if (!opened) sleepMs(10);
  }
  if (!opened) return '';
  try {
    const handle = GetClipboardData(CF_UNICODETEXT);
    if (!handle) return '';
    const locked = GlobalLock(handle);
    if (!locked) return '';
    try {
      const view = readCString16(locked);
      return view ?? '';
    } finally {
      GlobalUnlock(handle);
    }
  } finally {
    CloseClipboard();
  }
}

/** Read a NUL-terminated UTF-16 string at a native address. */
function readCString16(address: bigint): string | null {
  const units: number[] = [];
  let offset = 0n;
  for (;;) {
    const value = koffi.decode(address + offset, 'uint16');
    if (value === 0) break;
    units.push(value);
    offset += 2n;
    if (units.length > 1 << 20) break; // 1M chars: runaway guard
  }
  return String.fromCharCode(...units);
}

function sleepMs(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Write text to the clipboard (CF_UNICODETEXT, GMEM_MOVEABLE). */
export function writeClipboard(text: string): void {
  const bytes = utf16CodeUnits(text);
  // +2 for the NUL terminator; GlobalAlloc wants the byte count.
  const handle = GlobalAlloc(GMEM_MOVEABLE, bytes.length + 2);
  if (!handle) throw new Error('GlobalAlloc failed for clipboard text');
  const locked = GlobalLock(handle);
  if (!locked) {
    GlobalFree(handle);
    throw new Error('GlobalLock failed for clipboard text');
  }
  try {
    const view = koffi.view(locked, bytes.length + 2);
    new Uint8Array(view).set(bytes, 0);
    new Uint8Array(view, bytes.length, 2).fill(0); // NUL terminator
  } finally {
    GlobalUnlock(handle);
  }
  let opened = false;
  for (let attempt = 0; attempt < 5 && !opened; attempt += 1) {
    opened = !!OpenClipboard(null);
    if (!opened) sleepMs(10);
  }
  if (!opened) {
    GlobalFree(handle);
    throw new Error('Could not open the clipboard (held by another process)');
  }
  try {
    if (!EmptyClipboard()) {
      throw new Error('EmptyClipboard failed');
    }
    // On success the system owns the handle; do NOT free it.
    if (!SetClipboardData(CF_UNICODETEXT, handle)) {
      GlobalFree(handle);
      throw new Error('SetClipboardData failed');
    }
  } catch (error) {
    CloseClipboard();
    throw error;
  }
  CloseClipboard();
}
