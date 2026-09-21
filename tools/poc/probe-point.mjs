// Probes what window/control sits under given screen coordinates.
// Usage: node tools/poc/probe-point.mjs x y [x y ...]
import * as koffi from 'koffi';

const user32 = koffi.load('user32.dll');
const kernel32 = koffi.load('kernel32.dll');

const RECT = koffi.struct('R', {
  left: 'int32',
  top: 'int32',
  right: 'int32',
  bottom: 'int32',
});

const WindowFromPoint = user32.func(
  '__stdcall',
  'WindowFromPoint',
  'void *',
  ['int32', 'int32'],
);
const GetAncestor = user32.func(
  '__stdcall',
  'GetAncestor',
  'void *',
  ['void *', 'uint32'],
);
const GetWindowThreadProcessId = user32.func(
  '__stdcall',
  'GetWindowThreadProcessId',
  'uint32',
  ['void *', 'uint32 *'],
);
const GetClassNameW = user32.func(
  '__stdcall',
  'GetClassNameW',
  'int32',
  ['void *', 'void *', 'int32'],
);
const GetWindowRect = user32.func(
  '__stdcall',
  'GetWindowRect',
  'int32',
  ['void *', koffi.pointer(RECT)],
);
const OpenProcess = kernel32.func(
  '__stdcall',
  'OpenProcess',
  'void *',
  ['uint32', 'int32', 'uint32'],
);
const QueryFullProcessImageNameW = kernel32.func(
  '__stdcall',
  'QueryFullProcessImageNameW',
  'int32',
  ['void *', 'uint32', 'void *', 'uint32 *'],
);

const classBuf = new Uint16Array(256);

function readCString(buffer, length) {
  const end = buffer.indexOf(0);
  return String.fromCharCode(
    ...buffer.subarray(0, end === -1 ? length : end),
  );
}

function probe(x, y) {
  const hwnd = WindowFromPoint(x, y);
  if (!hwnd) {
    console.log(`(${x},${y}): no window`);
    return;
  }
  const root = GetAncestor(hwnd, 3) || hwnd;
  GetClassNameW(hwnd, classBuf, 256);
  const cls = readCString(classBuf, 256);
  const pid = new Uint32Array(1);
  GetWindowThreadProcessId(root, pid);
  let exe = '';
  const handle = OpenProcess(0x1000, 0, pid[0]);
  if (handle) {
    const size = new Uint32Array(1);
    size[0] = 1024;
    const pathBuf = new Uint16Array(1024);
    if (QueryFullProcessImageNameW(handle, 0, pathBuf, size)) {
      exe = readCString(pathBuf, size[0]).split('\\').pop() ?? '';
    }
  }
  const rectPtr = koffi.alloc(RECT, 1);
  try {
    GetWindowRect(root, rectPtr);
    const r = koffi.decode(rectPtr, RECT);
    console.log(
      `(${x},${y}): class=${cls} exe=${exe} rect=${r.left},${r.top} ${r.right - r.left}x${r.bottom - r.top}`,
    );
  } finally {
    koffi.free(rectPtr);
  }
}

const args = process.argv.slice(2).map(Number);
for (let i = 0; i + 1 < args.length; i += 2) {
  probe(args[i], args[i + 1]);
}
