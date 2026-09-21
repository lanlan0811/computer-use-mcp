/**
 * Win32 structure definitions for the worker's koffi bindings.
 *
 * All layouts verified against the Win64 ABI (see tools/poc/hook-poc.mjs).
 * The INPUT union MUST declare both mi and ki members — a single-member union
 * shrinks to that member's size and SendInput then rejects the batch with
 * ERROR_INVALID_PARAMETER (Phase 0 finding).
 */

import * as koffi from 'koffi';

export const POINT = koffi.struct('POINT_W', { x: 'int32', y: 'int32' });

export const RECT = koffi.struct('RECT_W', {
  left: 'int32',
  top: 'int32',
  right: 'int32',
  bottom: 'int32',
});

/** Low-level keyboard hook payload (win_helper.py:822-829). */
export const KBDLLHOOKSTRUCT = koffi.struct('KBDLLHOOKSTRUCT_W', {
  vkCode: 'uint32',
  scanCode: 'uint32',
  flags: 'uint32',
  time: 'uint32',
  dwExtraInfo: 'uint64',
});

/** Low-level mouse hook payload (win_helper.py:832-839). */
export const MSLLHOOKSTRUCT = koffi.struct('MSLLHOOKSTRUCT_W', {
  pt: POINT,
  mouseData: 'uint32',
  flags: 'uint32',
  time: 'uint32',
  dwExtraInfo: 'uint64',
});

const MOUSEINPUT = koffi.struct('MOUSEINPUT_W', {
  dx: 'int32',
  dy: 'int32',
  mouseData: 'uint32',
  dwFlags: 'uint32',
  time: 'uint32',
  dwExtraInfo: 'uint64',
});

const KEYBDINPUT = koffi.struct('KEYBDINPUT_W', {
  wVk: 'uint16',
  wScan: 'uint16',
  dwFlags: 'uint32',
  time: 'uint32',
  dwExtraInfo: 'uint64',
});

const HARDWAREINPUT = koffi.struct('HARDWAREINPUT_W', {
  uMsg: 'uint32',
  wParamL: 'uint16',
  wParamH: 'uint16',
});

export const INPUTUNION = koffi.union('INPUTUNION_W', {
  mi: MOUSEINPUT,
  ki: KEYBDINPUT,
  hi: HARDWAREINPUT,
});

export const INPUT = koffi.struct('INPUT_W', { type: 'uint32', u: INPUTUNION });

export const MSG = koffi.struct('MSG_W', {
  hwnd: 'void *',
  message: 'uint32',
  wParam: 'uint64',
  lParam: 'int64',
  time: 'uint32',
  pt: POINT,
});

/** BITMAPINFOHEADER for GetDIBits / CreateDIBSection (top-down 32bpp BGRA). */
export const BITMAPINFOHEADER = koffi.struct('BITMAPINFOHEADER_W', {
  biSize: 'uint32',
  biWidth: 'int32',
  biHeight: 'int32',
  biPlanes: 'uint16',
  biBitCount: 'uint16',
  biCompression: 'uint32',
  biSizeImage: 'uint32',
  biXPelsPerMeter: 'int32',
  biYPelsPerMeter: 'int32',
  biClrUsed: 'uint32',
  biClrImportant: 'uint32',
});

export const BITMAPINFO = koffi.struct('BITMAPINFO_W', {
  bmiHeader: BITMAPINFOHEADER,
  bmiColors: koffi.array('uint32', 1),
});

/** MONITORINFOEXW for EnumDisplayMonitors callbacks. */
export const MONITORINFOEXW = koffi.struct('MONITORINFOEXW_T', {
  cbSize: 'uint32',
  rcMonitor: RECT,
  rcWork: RECT,
  dwFlags: 'uint32',
  szDevice: koffi.array('uint16', 32),
});

/** WINDOWPLACEMENT for IsIconic-equivalent checks (showCmd offset). */
export const WINDOWPLACEMENT = koffi.struct('WINDOWPLACEMENT_W', {
  length: 'uint32',
  flags: 'uint32',
  showCmd: 'uint32',
  ptMinPosition: POINT,
  ptMaxPosition: POINT,
  rcNormalPosition: RECT,
});

/** Layout assertions: wrong sizes mean a silent FFI mismatch. */
export function assertStructLayouts(): void {
  const expected: Array<[string, number]> = [
    ['KBDLLHOOKSTRUCT', 24],
    ['MSLLHOOKSTRUCT', 32],
    ['INPUT', 40],
    ['MSG', 48],
    ['BITMAPINFOHEADER', 40],
    ['MONITORINFOEXW', 40 + 64],
    ['WINDOWPLACEMENT', 44],
  ];
  const map: Record<string, unknown> = {
    KBDLLHOOKSTRUCT,
    MSLLHOOKSTRUCT,
    INPUT,
    MSG,
    BITMAPINFOHEADER,
    MONITORINFOEXW,
    WINDOWPLACEMENT,
  };
  for (const [name, size] of expected) {
    const actual = koffi.sizeof(map[name] as string);
    if (actual !== size) {
      throw new Error(
        `struct ${name} has sizeof ${actual}, expected ${size}; ` +
          'the Win64 ABI assumptions in this worker are wrong',
      );
    }
  }
}

/**
 * Allocate a struct, run `fn` with its pointer, decode and free it.
 *
 * koffi structs are not constructors (`new RECT()` throws), and the plain
 * output-object shorthand silently fails for structs with nested records
 * (Phase 0 finding). Explicit alloc + decode is the reliable out-param
 * pattern; the free keeps hot paths (per-frame cursor reads) from leaking.
 */
export function withStruct<T>(
  type: Parameters<typeof koffi.sizeof>[0],
  fn: (ptr: bigint) => void,
): T {
  const ptr = koffi.alloc(type, 1);
  try {
    fn(ptr);
    return koffi.decode(ptr, type) as T;
  } finally {
    koffi.free(ptr);
  }
}
