// Reports the current foreground window: process, title, rect.
import * as koffi from 'koffi';

const user32 = koffi.load('user32.dll');
const kernel32 = koffi.load('kernel32.dll');

const RECT = koffi.struct('R', {
  left: 'int32',
  top: 'int32',
  right: 'int32',
  bottom: 'int32',
});

const GetForegroundWindow = user32.func(
  '__stdcall',
  'GetForegroundWindow',
  'void *',
  [],
);
const GetWindowThreadProcessId = user32.func(
  '__stdcall',
  'GetWindowThreadProcessId',
  'uint32',
  ['void *', 'uint32 *'],
);
const GetWindowTextW = user32.func('__stdcall', 'GetWindowTextW', 'int32', [
  'void *',
  'void *',
  'int32',
]);
const GetWindowRect = user32.func('__stdcall', 'GetWindowRect', 'int32', [
  'void *',
  koffi.pointer(RECT),
]);
const GetClassNameW = user32.func('__stdcall', 'GetClassNameW', 'int32', [
  'void *',
  'void *',
  'int32',
]);
const OpenProcess = kernel32.func('__stdcall', 'OpenProcess', 'void *', [
  'uint32',
  'int32',
  'uint32',
]);
const QueryFullProcessImageNameW = kernel32.func(
  '__stdcall',
  'QueryFullProcessImageNameW',
  'int32',
  ['void *', 'uint32', 'void *', 'uint32 *'],
);

function readWide(buffer, length) {
  const end = buffer.indexOf(0);
  return String.fromCharCode(...buffer.subarray(0, end === -1 ? length : end));
}

const hwnd = GetForegroundWindow();
if (!hwnd) {
  console.log('no foreground window');
  process.exit(0);
}
const pid = new Uint32Array(1);
GetWindowThreadProcessId(hwnd, pid);
let exe = '';
const handle = OpenProcess(0x1000, 0, pid[0]);
if (handle) {
  const size = new Uint32Array(1);
  size[0] = 1024;
  const pathBuf = new Uint16Array(1024);
  if (QueryFullProcessImageNameW(handle, 0, pathBuf, size)) {
    exe = readWide(pathBuf, size[0]);
  }
}
const titleBuf = new Uint16Array(512);
GetWindowTextW(hwnd, titleBuf, 512);
const classBuf = new Uint16Array(256);
GetClassNameW(hwnd, classBuf, 256);
const rectPtr = koffi.alloc(RECT, 1);
GetWindowRect(hwnd, rectPtr);
const r = koffi.decode(rectPtr, RECT);
console.log(`foreground pid=${pid[0]} exe=${exe.split('\\').pop()}`);
console.log(`title="${readWide(titleBuf, 512)}"`);
console.log(
  `class="${readWide(classBuf, 256)}" rect=${r.left},${r.top} ${r.right - r.left}x${r.bottom - r.top}`,
);
