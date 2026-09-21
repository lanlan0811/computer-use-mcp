/**
 * koffi bindings for the Win32 APIs the worker calls.
 *
 * Grouped by DLL. Calling conventions are __stdcall (Win32 API). Handles are
 * opaque pointers; pointers are BigInt.
 */

import * as koffi from 'koffi';

import {
  BITMAPINFO,
  INPUT,
  MONITORINFOEXW,
  MSG,
  POINT,
  RECT,
  WINDOWPLACEMENT,
} from './structs.js';

export const user32 = koffi.load('user32.dll');
export const kernel32 = koffi.load('kernel32.dll');
export const gdi32 = koffi.load('gdi32.dll');
export const shcore = koffi.load('shcore.dll');
export const advapi32 = koffi.load('advapi32.dll');
export const shell32 = koffi.load('shell32.dll');

// --- prototype types ---------------------------------------------------------
export const HOOKPROC = koffi.proto(
  'int64_t __stdcall HookProc(int32, uint64, int64)',
);
export const ENUMPROC = koffi.proto(
  'int32_t __stdcall EnumProc(void *, int64_t)',
);
export const MONITORENUMPROC = koffi.proto(
  'int32_t __stdcall MonitorEnumProc(void *, void *, void *, int64_t)',
);

// --- kernel32 ----------------------------------------------------------------
export const GetCurrentThreadId = kernel32.func(
  '__stdcall',
  'GetCurrentThreadId',
  'uint32',
  [],
);
export const Sleep = kernel32.func('__stdcall', 'Sleep', 'void', ['uint32']);
export const GetLastError = kernel32.func(
  '__stdcall',
  'GetLastError',
  'uint32',
  [],
);
export const GlobalAlloc = kernel32.func('__stdcall', 'GlobalAlloc', 'void *', [
  'uint32',
  'size_t',
]);
export const GlobalFree = kernel32.func('__stdcall', 'GlobalFree', 'void *', [
  'void *',
]);
export const GlobalLock = kernel32.func('__stdcall', 'GlobalLock', 'void *', [
  'void *',
]);
export const GlobalUnlock = kernel32.func(
  '__stdcall',
  'GlobalUnlock',
  'int32',
  ['void *'],
);
export const QueryFullProcessImageNameW = kernel32.func(
  '__stdcall',
  'QueryFullProcessImageNameW',
  'int32',
  ['void *', 'uint32', 'void *', 'uint32 *'],
);
export const OpenProcess = kernel32.func('__stdcall', 'OpenProcess', 'void *', [
  'uint32',
  'int32',
  'uint32',
]);
export const CloseHandle = kernel32.func('__stdcall', 'CloseHandle', 'int32', [
  'void *',
]);
export const GetFileAttributesW = kernel32.func(
  '__stdcall',
  'GetFileAttributesW',
  'uint32',
  ['string16'],
);

// --- user32: messages / hooks ------------------------------------------------
export const PeekMessageW = user32.func('__stdcall', 'PeekMessageW', 'int32', [
  koffi.pointer(MSG),
  'void *',
  'uint32',
  'uint32',
  'uint32',
]);
export const PostThreadMessageW = user32.func(
  '__stdcall',
  'PostThreadMessageW',
  'int32',
  ['uint32', 'uint32', 'uint64', 'int64'],
);
export const SetWindowsHookExW = user32.func(
  '__stdcall',
  'SetWindowsHookExW',
  'void *',
  ['int32', koffi.pointer(HOOKPROC), 'void *', 'uint32'],
);
export const UnhookWindowsHookEx = user32.func(
  '__stdcall',
  'UnhookWindowsHookEx',
  'int32',
  ['void *'],
);
export const CallNextHookEx = user32.func(
  '__stdcall',
  'CallNextHookEx',
  'int64_t',
  ['void *', 'int32', 'uint64', 'int64'],
);

// --- user32: input -----------------------------------------------------------
export const SendInput = user32.func('__stdcall', 'SendInput', 'uint32', [
  'uint32',
  koffi.pointer(INPUT),
  'int32',
]);
export const GetCursorPos = user32.func('__stdcall', 'GetCursorPos', 'int32', [
  koffi.pointer(POINT),
]);
export const GetAsyncKeyState = user32.func(
  '__stdcall',
  'GetAsyncKeyState',
  'int16',
  ['int32'],
);
export const GetSystemMetrics = user32.func(
  '__stdcall',
  'GetSystemMetrics',
  'int32',
  ['int32'],
);
export const VkKeyScanW = user32.func('__stdcall', 'VkKeyScanW', 'int16', [
  'uint16',
]);
export const MapVirtualKeyW = user32.func(
  '__stdcall',
  'MapVirtualKeyW',
  'uint32',
  ['uint32', 'uint32'],
);
export const keybd_event = user32.func('__stdcall', 'keybd_event', 'void', [
  'uint8',
  'uint8',
  'uint32',
  'uint64',
]);

// --- user32: windows ---------------------------------------------------------
export const EnumWindows = user32.func('__stdcall', 'EnumWindows', 'int32', [
  koffi.pointer(ENUMPROC),
  'int64_t',
]);
export const EnumChildWindows = user32.func(
  '__stdcall',
  'EnumChildWindows',
  'int32',
  ['void *', koffi.pointer(ENUMPROC), 'int64_t'],
);
export const IsWindowVisible = user32.func(
  '__stdcall',
  'IsWindowVisible',
  'int32',
  ['void *'],
);
export const IsWindow = user32.func('__stdcall', 'IsWindow', 'int32', [
  'void *',
]);
export const IsIconic = user32.func('__stdcall', 'IsIconic', 'int32', [
  'void *',
]);
export const GetWindowTextW = user32.func(
  '__stdcall',
  'GetWindowTextW',
  'int32',
  ['void *', 'void *', 'int32'],
);
export const GetWindowTextLengthW = user32.func(
  '__stdcall',
  'GetWindowTextLengthW',
  'int32',
  ['void *'],
);
export const GetClassNameW = user32.func(
  '__stdcall',
  'GetClassNameW',
  'int32',
  ['void *', 'void *', 'int32'],
);
export const GetWindowRect = user32.func(
  '__stdcall',
  'GetWindowRect',
  'int32',
  ['void *', koffi.pointer(RECT)],
);
export const GetWindowThreadProcessId = user32.func(
  '__stdcall',
  'GetWindowThreadProcessId',
  'uint32',
  ['void *', 'uint32 *'],
);
export const GetForegroundWindow = user32.func(
  '__stdcall',
  'GetForegroundWindow',
  'void *',
  [],
);
export const WindowFromPoint = user32.func(
  '__stdcall',
  'WindowFromPoint',
  'void *',
  ['int32', 'int32'],
);
export const GetAncestor = user32.func('__stdcall', 'GetAncestor', 'void *', [
  'void *',
  'uint32',
]);
export const ShowWindow = user32.func('__stdcall', 'ShowWindow', 'int32', [
  'void *',
  'int32',
]);
export const SetForegroundWindow = user32.func(
  '__stdcall',
  'SetForegroundWindow',
  'int32',
  ['void *'],
);
export const GetWindowPlacement = user32.func(
  '__stdcall',
  'GetWindowPlacement',
  'int32',
  ['void *', koffi.pointer(WINDOWPLACEMENT)],
);

// --- user32: DPI / displays --------------------------------------------------
export const SetProcessDpiAwarenessContext = user32.func(
  '__stdcall',
  'SetProcessDpiAwarenessContext',
  'int32',
  ['void *'],
);
export const SetProcessDPIAware = user32.func(
  '__stdcall',
  'SetProcessDPIAware',
  'int32',
  [],
);
// EnumDisplayMonitors has no A/W suffix — there is a single export.
export const EnumDisplayMonitorsW = user32.func(
  '__stdcall',
  'EnumDisplayMonitors',
  'int32',
  ['void *', 'void *', koffi.pointer(MONITORENUMPROC), 'int64_t'],
);
export const GetMonitorInfoW = user32.func(
  '__stdcall',
  'GetMonitorInfoW',
  'int32',
  ['void *', koffi.pointer(MONITORINFOEXW)],
);
export const MonitorFromPoint = user32.func(
  '__stdcall',
  'MonitorFromPoint',
  'void *',
  ['int32', 'int32', 'uint32'],
);

// --- shcore ------------------------------------------------------------------
export const SetProcessDpiAwareness = shcore.func(
  '__stdcall',
  'SetProcessDpiAwareness',
  'int32',
  ['int32'],
);
export const GetDpiForMonitor = shcore.func(
  '__stdcall',
  'GetDpiForMonitor',
  'int32',
  ['void *', 'int32', 'uint32 *', 'uint32 *'],
);

// --- gdi32 -------------------------------------------------------------------
export const CreateDCW = gdi32.func('__stdcall', 'CreateDCW', 'void *', [
  'string16',
  'string16',
  'string16',
  'void *',
]);
export const CreateCompatibleDC = gdi32.func(
  '__stdcall',
  'CreateCompatibleDC',
  'void *',
  ['void *'],
);
export const CreateDIBSection = gdi32.func(
  '__stdcall',
  'CreateDIBSection',
  'void *',
  [
    'void *',
    koffi.pointer(BITMAPINFO),
    'uint32',
    koffi.pointer('void *'),
    'void *',
    'uint32',
  ],
);
export const SelectObject = gdi32.func('__stdcall', 'SelectObject', 'void *', [
  'void *',
  'void *',
]);
export const BitBlt = gdi32.func('__stdcall', 'BitBlt', 'int32', [
  'void *',
  'int32',
  'int32',
  'int32',
  'int32',
  'void *',
  'int32',
  'int32',
  'uint32',
]);
export const DeleteObject = gdi32.func('__stdcall', 'DeleteObject', 'int32', [
  'void *',
]);
export const DeleteDC = gdi32.func('__stdcall', 'DeleteDC', 'int32', [
  'void *',
]);

// --- user32: clipboard -------------------------------------------------------
export const OpenClipboard = user32.func(
  '__stdcall',
  'OpenClipboard',
  'int32',
  ['void *'],
);
export const CloseClipboard = user32.func(
  '__stdcall',
  'CloseClipboard',
  'int32',
  [],
);
export const EmptyClipboard = user32.func(
  '__stdcall',
  'EmptyClipboard',
  'int32',
  [],
);
export const SetClipboardData = user32.func(
  '__stdcall',
  'SetClipboardData',
  'void *',
  ['uint32', 'void *'],
);
export const GetClipboardData = user32.func(
  '__stdcall',
  'GetClipboardData',
  'void *',
  ['uint32'],
);
export const IsClipboardFormatAvailable = user32.func(
  '__stdcall',
  'IsClipboardFormatAvailable',
  'int32',
  ['uint32'],
);

// --- advapi32: registry ------------------------------------------------------
export const RegOpenKeyExW = advapi32.func(
  '__stdcall',
  'RegOpenKeyExW',
  'int32',
  ['void *', 'string16', 'uint32', 'uint32', koffi.pointer('void *')],
);
export const RegCloseKey = advapi32.func('__stdcall', 'RegCloseKey', 'int32', [
  'void *',
]);
export const RegEnumKeyExW = advapi32.func(
  '__stdcall',
  'RegEnumKeyExW',
  'int32',
  [
    'void *',
    'uint32',
    'void *',
    'uint32 *',
    'void *',
    'void *',
    'uint32 *',
    'void *',
  ],
);
export const RegQueryValueExW = advapi32.func(
  '__stdcall',
  'RegQueryValueExW',
  'int32',
  ['void *', 'string16', 'void *', 'uint32 *', 'void *', 'uint32 *'],
);

// --- shell32 -----------------------------------------------------------------
export const ShellExecuteW = shell32.func(
  '__stdcall',
  'ShellExecuteW',
  'void *',
  ['void *', 'string16', 'string16', 'string16', 'string16', 'int32'],
);

// --- constants ---------------------------------------------------------------
export const WH_KEYBOARD_LL = 13;
export const WH_MOUSE_LL = 14;
export const HC_ACTION = 0;
export const WM_QUIT = 0x0012;
export const WM_APP_INPUT_BARRIER = 0x8001;
export const PM_REMOVE = 0x0001;
export const LLKHF_INJECTED = 0x10;
export const LLKHF_LOWER_IL_INJECTED = 0x02;
export const LLMHF_INJECTED = 0x01;
export const LLMHF_LOWER_IL_INJECTED = 0x02;
export const INPUT_MOUSE = 0;
export const INPUT_KEYBOARD = 1;
export const KEYEVENTF_KEYUP = 0x0002;
export const KEYEVENTF_UNICODE = 0x0004;
export const MOUSEEVENTF_MOVE = 0x0001;
export const MOUSEEVENTF_LEFTDOWN = 0x0002;
export const MOUSEEVENTF_LEFTUP = 0x0004;
export const MOUSEEVENTF_RIGHTDOWN = 0x0008;
export const MOUSEEVENTF_RIGHTUP = 0x0010;
export const MOUSEEVENTF_MIDDLEDOWN = 0x0020;
export const MOUSEEVENTF_MIDDLEUP = 0x0040;
export const MOUSEEVENTF_WHEEL = 0x0800;
export const MOUSEEVENTF_HWHEEL = 0x1000;
export const MOUSEEVENTF_MOVE_NOCOALESCE = 0x2000;
export const MOUSEEVENTF_VIRTUALDESK = 0x4000;
export const MOUSEEVENTF_ABSOLUTE = 0x8000;
export const WHEEL_DELTA = 120;
export const SM_XVIRTUALSCREEN = 76;
export const SM_YVIRTUALSCREEN = 77;
export const SM_CXVIRTUALSCREEN = 78;
export const SM_CYVIRTUALSCREEN = 79;
export const SRCCOPY = 0x00cc0020;
export const CAPTUREBLT = 0x40000000;
export const DIB_RGB_COLORS = 0;
export const BI_RGB = 0;
export const GMEM_MOVEABLE = 0x0002;
export const CF_UNICODETEXT = 13;
export const HKEY_LOCAL_MACHINE = 0x80000002n;
export const HKEY_CURRENT_USER = 0x80000001n;
export const KEY_READ = 0x20019;
export const REG_SZ = 1;
export const ERROR_SUCCESS = 0;
export const ERROR_NO_MORE_ITEMS = 259;
export const SW_RESTORE = 9;
export const SW_SHOWMINIMIZED = 2;
export const GA_ROOTOWNER = 3;
export const MONITOR_DEFAULTTONEAREST = 2;
export const MDT_EFFECTIVE_DPI = 0;
export const PER_MONITOR_AWARE_V2 = -4;
export const INVALID_HANDLE_VALUE = 0xffffffffn;
export const SW_SHOWNORMAL = 1;

/** Default DPI awareness context sentinel (-4), passed as a pointer value. */
export const DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = BigInt.asIntN(
  64,
  BigInt(PER_MONITOR_AWARE_V2),
);
