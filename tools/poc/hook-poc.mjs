// Phase 0 POC: koffi low-level input hooks with a main-thread pump.
//
// Verifies the four hard-gate criteria from the development plan:
//   1. WH_KEYBOARD_LL and WH_MOUSE_LL both install (including from a
//      CreateThread-spawned context), and survive that thread's exit;
//   2. hook callbacks cross back into JS and count correctly;
//   3. tagged SendInput events are distinguished from untagged / legacy events;
//   4. the PostThreadMessageW barrier drains callbacks before reading, and
//      hooks shut down cleanly.
//
// Mirrors cc-haha runtime/win_helper.py PhysicalInputMonitor (lines 946-1124).
//
// koffi constraints proven by micro-tests during Phase 0 (see tools/poc/):
//   * koffi executes JS callbacks on the Node main thread only. A callback
//     registered for CreateThread runs on the main thread (micro-test D3:
//     GetCurrentThreadId inside the callback equals the main thread id), so a
//     native pump thread is not expressible: GetMessageW would block the main
//     thread and starve queued callbacks.
//   * libuv's own loop does not deliver LL hook events by itself (micro-test
//     MT1: 0 callbacks during a pure await), but once the main thread owns a
//     message queue (created by the first PeekMessageW), hook callbacks fire
//     both during PeekMessageW drains and during event-loop awaits (diag 3).
//   * PeekMessageW must receive an explicit allocated MSG buffer; koffi's
//     output-object shorthand silently fails for the nested MSG struct (diag
//     vs diag2).
//
// Consequence for the architecture: the pump lives on the worker process main
// thread. Input events are queued to that thread and their hook procs are
// invoked during PeekMessageW, in FIFO order. The barrier therefore posts
// WM_APP_INPUT_BARRIER and drains synchronously until that message is
// retrieved: every earlier input event has already run its callback by then.
// Crash isolation is preserved at process level (the worker is a subprocess).

import koffi from 'koffi';
import crypto from 'node:crypto';

const user32 = koffi.load('user32.dll');
const kernel32 = koffi.load('kernel32.dll');

// --- Win32 constants (win_helper.py:774-799) --------------------------------
const WH_KEYBOARD_LL = 13;
const WH_MOUSE_LL = 14;
const HC_ACTION = 0;
const WM_APP_INPUT_BARRIER = 0x8001;
const PM_REMOVE = 0x0001;
const LLKHF_INJECTED = 0x10;
const LLKHF_LOWER_IL_INJECTED = 0x02;
const LLMHF_INJECTED = 0x01;
const LLMHF_LOWER_IL_INJECTED = 0x02;
const INPUT_MOUSE = 0;
const INPUT_KEYBOARD = 1;
const KEYEVENTF_KEYUP = 0x0002;
const MOUSEEVENTF_MOVE = 0x0001;
const VK_F15 = 0x7e;

// --- Structs (win_helper.py:822-881) ----------------------------------------
const KBDLLHOOKSTRUCT = koffi.struct('KBDLLHOOKSTRUCT', {
  vkCode: 'uint32',
  scanCode: 'uint32',
  flags: 'uint32',
  time: 'uint32',
  dwExtraInfo: 'uint64',
});
const MSLLHOOKSTRUCT = koffi.struct('MSLLHOOKSTRUCT', {
  pt: koffi.struct('POINT_POC', { x: 'int32', y: 'int32' }),
  mouseData: 'uint32',
  flags: 'uint32',
  time: 'uint32',
  dwExtraInfo: 'uint64',
});
const INPUTUNION = koffi.union('INPUTUNION_POC', {
  mi: koffi.struct('MOUSEINPUT_POC', {
    dx: 'int32',
    dy: 'int32',
    mouseData: 'uint32',
    dwFlags: 'uint32',
    time: 'uint32',
    dwExtraInfo: 'uint64',
  }),
  ki: koffi.struct('KEYBDINPUT_POC', {
    wVk: 'uint16',
    wScan: 'uint16',
    dwFlags: 'uint32',
    time: 'uint32',
    dwExtraInfo: 'uint64',
  }),
});
const INPUT = koffi.struct('INPUT_POC', { type: 'uint32', u: INPUTUNION });
const MSG = koffi.struct('MSG_POC', {
  hwnd: 'void *',
  message: 'uint32',
  wParam: 'uint64',
  lParam: 'int64',
  time: 'uint32',
  pt: koffi.struct('POINT_MSG_POC', { x: 'int32', y: 'int32' }),
});

// Sanity: layouts must match the Win64 ABI, otherwise SendInput would feed
// garbage to the system input stream.
const SIZES = [
  ['KBDLLHOOKSTRUCT', koffi.sizeof(KBDLLHOOKSTRUCT), 24],
  ['MSLLHOOKSTRUCT', koffi.sizeof(MSLLHOOKSTRUCT), 32],
  ['INPUT', koffi.sizeof(INPUT), 40],
  ['MSG', koffi.sizeof(MSG), 48],
];

// --- Bindings ----------------------------------------------------------------
const HOOKPROC = koffi.proto('int64_t __stdcall HookProc(int32, uint64, int64)');
const THREADPROC = koffi.proto('uint32 __stdcall ThreadProc(void *)');

const GetCurrentThreadId = kernel32.func(
  '__stdcall',
  'GetCurrentThreadId',
  'uint32',
  [],
);
const PeekMessageW = user32.func(
  '__stdcall',
  'PeekMessageW',
  'int32',
  [koffi.pointer(MSG), 'void *', 'uint32', 'uint32', 'uint32'],
);
const PostThreadMessageW = user32.func(
  '__stdcall',
  'PostThreadMessageW',
  'int32',
  ['uint32', 'uint32', 'uint64', 'int64'],
);
const SetWindowsHookExW = user32.func(
  '__stdcall',
  'SetWindowsHookExW',
  'void *',
  ['int32', koffi.pointer(HOOKPROC), 'void *', 'uint32'],
);
const UnhookWindowsHookEx = user32.func(
  '__stdcall',
  'UnhookWindowsHookEx',
  'int32',
  ['void *'],
);
const CallNextHookEx = user32.func(
  '__stdcall',
  'CallNextHookEx',
  'int64_t',
  ['void *', 'int32', 'uint64', 'int64'],
);
const SendInput = user32.func(
  '__stdcall',
  'SendInput',
  'uint32',
  ['uint32', koffi.pointer(INPUT), 'int32'],
);
const keybd_event = user32.func(
  '__stdcall',
  'keybd_event',
  'void',
  ['uint8', 'uint8', 'uint32', 'uint64'],
);
const CreateThread = kernel32.func(
  '__stdcall',
  'CreateThread',
  'void *',
  ['void *', 'size_t', koffi.pointer(THREADPROC), 'void *', 'uint32', 'uint32 *'],
);
const Sleep = kernel32.func('__stdcall', 'Sleep', 'void', ['uint32']);

// --- Monitor state (mirrors PhysicalInputMonitor) ----------------------------
// Random non-zero 32-bit tag: mouse low-level hooks preserve only the low 32
// bits of dwExtraInfo on some 64-bit Windows builds, keyboard hooks keep the
// full ULONG_PTR, so a 32-bit tag compares identically on both paths
// (win_helper.py:806-814).
const INPUT_TAG = BigInt(crypto.randomInt(1, 0xffffffff));

const monitor = {
  threadId: 0,
  keyboardHook: null,
  mouseHook: null,
  interferenceCount: 0,
  agentCount: 0,
  expectedAgentCount: 0,
  kbdAgent: 0,
  kbdOther: 0,
  mouseAgent: 0,
  mouseOther: 0,
  error: null,
  installed: false,
};

function record(which, flags, injectedMask, extraInfo) {
  // koffi decodes uint64 struct fields as Number when the value fits in the
  // safe-integer range, so normalize to BigInt before comparing with the tag.
  const extra = BigInt(extraInfo);
  if ((flags & injectedMask) !== 0 && extra === INPUT_TAG) {
    monitor.agentCount += 1;
    if (which === 'kbd') monitor.kbdAgent += 1;
    else monitor.mouseAgent += 1;
  } else {
    monitor.interferenceCount += 1;
    if (which === 'kbd') monitor.kbdOther += 1;
    else monitor.mouseOther += 1;
  }
}

// Registered callbacks must stay strongly referenced for the lifetime of the
// hooks, or Windows may call freed memory (win_helper.py:960-964).
const keyboardProc = koffi.register((code, wParam, lParam) => {
  try {
    if (code === HC_ACTION) {
      const data = koffi.decode(lParam, KBDLLHOOKSTRUCT);
      record(
        'kbd',
        data.flags,
        LLKHF_INJECTED | LLKHF_LOWER_IL_INJECTED,
        data.dwExtraInfo,
      );
    }
  } catch (exc) {
    monitor.error = exc;
  }
  return CallNextHookEx(null, code, wParam, lParam);
}, koffi.pointer(HOOKPROC));
const mouseProc = koffi.register((code, wParam, lParam) => {
  try {
    if (code === HC_ACTION) {
      const data = koffi.decode(lParam, MSLLHOOKSTRUCT);
      record(
        'mouse',
        data.flags,
        LLMHF_INJECTED | LLMHF_LOWER_IL_INJECTED,
        data.dwExtraInfo,
      );
    }
  } catch (exc) {
    monitor.error = exc;
  }
  return CallNextHookEx(null, code, wParam, lParam);
}, koffi.pointer(HOOKPROC));

// --- Message queue and barrier ----------------------------------------------
const msgBuf = koffi.alloc(MSG, 1);

function ensureMessageQueue() {
  // PeekMessage creates the thread's message queue, which is required before
  // PostThreadMessageW can target it (win_helper.py:1011-1016).
  PeekMessageW(msgBuf, null, 0, 0, PM_REMOVE);
  monitor.threadId = Number(GetCurrentThreadId());
}

// Barrier: post the barrier message, then drain synchronously until it is
// retrieved. Input events queued before it have already run their hook
// callbacks during this drain (FIFO), so the counters are safe to read.
function barrier(timeoutMs = 2000) {
  if (monitor.error) {
    throw new Error(`input monitor error: ${monitor.error}`);
  }
  if (!PostThreadMessageW(monitor.threadId, WM_APP_INPUT_BARRIER, 0, 0)) {
    throw new Error(`PostThreadMessageW(barrier) failed: ${koffi.errno()}`);
  }
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (PeekMessageW(msgBuf, null, 0, 0, PM_REMOVE)) {
      const msg = koffi.decode(msgBuf, MSG);
      if (msg.message === WM_APP_INPUT_BARRIER) {
        if (monitor.error) {
          throw new Error(`input monitor error: ${monitor.error}`);
        }
        if (monitor.agentCount < monitor.expectedAgentCount) {
          throw new Error('monitor stopped reporting tagged input');
        }
        return {
          interference: monitor.interferenceCount,
          agent: monitor.agentCount,
          kbdAgent: monitor.kbdAgent,
          kbdOther: monitor.kbdOther,
          mouseAgent: monitor.mouseAgent,
          mouseOther: monitor.mouseOther,
        };
      }
    }
    if (Date.now() > deadline) {
      throw new Error('barrier timed out');
    }
    Sleep(1);
  }
}

// --- Input helpers -----------------------------------------------------------
function eventExtraInfo(event) {
  const data = event.u.ki ?? event.u.mi;
  return BigInt(data.dwExtraInfo ?? 0);
}

function sendInputs(events) {
  if (events.length === 0) return 0;
  // Koffi converts a JS array of struct objects into a C array for a pointer
  // parameter (koffi doc/pointers.md, dynamic arrays).
  const sent = SendInput(events.length, events, koffi.sizeof(INPUT));
  if (sent !== events.length) {
    throw new Error(`SendInput accepted only ${sent} of ${events.length} events`);
  }
  // Only tagged events are expected to show up as agent input; untagged test
  // events must land in the interference counter (cc-haha _record semantics).
  monitor.expectedAgentCount += events.filter((e) => eventExtraInfo(e) === INPUT_TAG).length;
  return sent;
}

function taggedKey(vk, keyUp) {
  return {
    type: INPUT_KEYBOARD,
    u: {
      ki: {
        wVk: vk,
        wScan: 0,
        dwFlags: keyUp ? KEYEVENTF_KEYUP : 0,
        time: 0,
        dwExtraInfo: INPUT_TAG,
      },
    },
  };
}

function untaggedKey(vk, keyUp) {
  const e = taggedKey(vk, keyUp);
  e.u.ki.dwExtraInfo = 0n;
  return e;
}

function taggedMouseMove(dx) {
  return {
    type: INPUT_MOUSE,
    u: {
      mi: {
        dx,
        dy: 0,
        mouseData: 0,
        dwFlags: MOUSEEVENTF_MOVE,
        time: 0,
        dwExtraInfo: INPUT_TAG,
      },
    },
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- POC run -----------------------------------------------------------
let failures = 0;
function check(name, ok, detail) {
  const status = ok ? 'PASS' : 'FAIL';
  if (!ok) failures += 1;
  console.log(`[${status}] ${name}${detail ? ` -- ${detail}` : ''}`);
}

for (const [name, actual, expected] of SIZES) {
  check(`struct layout ${name}`, actual === expected, `sizeof=${actual}, expected ${expected}`);
}

// Criterion 1a: install both hooks from a CreateThread-spawned context.
// koffi runs the registered thread callback on the main thread, so this proves
// the install path works and that hooks survive the native thread's exit.
// Note: koffi delivers queued callbacks on an unref'd handle, so the wait loop
// must keep the event loop alive with timers.
const nativeInstall = { done: false, result: null };
{
  const threadProc = koffi.register(() => {
    try {
      const kbd = SetWindowsHookExW(WH_KEYBOARD_LL, keyboardProc, null, 0);
      const mouse = SetWindowsHookExW(WH_MOUSE_LL, mouseProc, null, 0);
      nativeInstall.result = {
        kbd: !!kbd,
        mouse: !!mouse,
        kbdHandle: kbd,
        mouseHandle: mouse,
      };
    } catch (exc) {
      nativeInstall.result = { error: String(exc) };
    }
    nativeInstall.done = true;
    return 0;
  }, koffi.pointer(THREADPROC));
  const handle = CreateThread(null, 0, threadProc, null, 0, null);
  if (!handle) {
    nativeInstall.result = { error: 'CreateThread failed' };
    nativeInstall.done = true;
  }
  const deadline = Date.now() + 2000;
  while (!nativeInstall.done && Date.now() < deadline) {
    await sleep(10);
  }
}

check(
  'hooks install from CreateThread-spawned context',
  nativeInstall.result?.kbd === true && nativeInstall.result?.mouse === true,
  nativeInstall.result?.error ?? `kbd=${nativeInstall.result?.kbd} mouse=${nativeInstall.result?.mouse}`,
);
monitor.keyboardHook = nativeInstall.result?.kbdHandle ?? null;
monitor.mouseHook = nativeInstall.result?.mouseHandle ?? null;
monitor.installed = !!monitor.keyboardHook && !!monitor.mouseHook;
if (!monitor.installed) {
  console.log('POC RESULT: FAIL (hooks did not install)');
  process.exit(1);
}

// The native thread has exited by now (its callback returned); verify the
// hooks still fire.
ensureMessageQueue();
{
  const before = barrier();
  const sent = sendInputs([taggedKey(VK_F15, false), taggedKey(VK_F15, true)]);
  const after = barrier();
  check(
    'hooks survive native thread exit and still count',
    sent === 2 && after.kbdAgent - before.kbdAgent === 2,
    `sent=${sent} delta=${after.kbdAgent - before.kbdAgent}`,
  );
}

// Criterion 2 + 3: counting and tag discrimination on both hooks.
{
  const before = barrier();
  const sent = sendInputs([
    taggedKey(VK_F15, false),
    taggedKey(VK_F15, true),
    taggedMouseMove(1),
    taggedMouseMove(-1),
  ]);
  const after = barrier();
  check('SendInput batch accepted fully', sent === 4, `sent=${sent}`);
  check(
    'tagged keyboard events counted as agent input',
    after.kbdAgent - before.kbdAgent === 2,
    `delta=${after.kbdAgent - before.kbdAgent}`,
  );
  check(
    'tagged keyboard events caused no interference',
    after.kbdOther - before.kbdOther === 0,
    `delta=${after.kbdOther - before.kbdOther}`,
  );
  check(
    'tagged mouse events counted as agent input',
    after.mouseAgent - before.mouseAgent === 2,
    `delta=${after.mouseAgent - before.mouseAgent}`,
  );
  check(
    'tagged mouse events caused no interference',
    after.mouseOther - before.mouseOther === 0,
    `delta=${after.mouseOther - before.mouseOther}`,
  );
}

// Criterion 3: untagged SendInput -> interference.
{
  const before = barrier();
  const sent = sendInputs([untaggedKey(VK_F15, false), untaggedKey(VK_F15, true)]);
  const after = barrier();
  check('untagged SendInput accepted', sent === 2, `sent=${sent}`);
  check(
    'untagged SendInput counted as interference',
    after.kbdOther - before.kbdOther === 2,
    `delta=${after.kbdOther - before.kbdOther}`,
  );
}

// Criterion 3: legacy keybd_event -> interference (separate window).
{
  const before = barrier();
  keybd_event(VK_F15, 0, 0, 0n);
  keybd_event(VK_F15, 0, KEYEVENTF_KEYUP, 0n);
  const after = barrier();
  check(
    'legacy keybd_event counted as interference',
    after.kbdOther - before.kbdOther === 2,
    `kbdOther delta=${after.kbdOther - before.kbdOther}`,
  );
}

// Criterion 4: barrier drains callbacks posted before it.
{
  const before = barrier();
  const sent = sendInputs(Array.from({ length: 10 }, (_, i) => taggedKey(VK_F15, i % 2 === 1)));
  // Post the barrier immediately: all 10 events are already queued ahead of it.
  if (!PostThreadMessageW(monitor.threadId, WM_APP_INPUT_BARRIER, 0, 0)) {
    throw new Error('PostThreadMessageW(barrier) failed');
  }
  const deadline = Date.now() + 2000;
  let drained = false;
  for (;;) {
    if (PeekMessageW(msgBuf, null, 0, 0, PM_REMOVE)) {
      const msg = koffi.decode(msgBuf, MSG);
      if (msg.message === WM_APP_INPUT_BARRIER) {
        drained = true;
        break;
      }
    }
    if (Date.now() > deadline) break;
    Sleep(1);
  }
  const after = barrier();
  check(
    'barrier drained callbacks before read',
    drained && sent === 10 && after.kbdAgent - before.kbdAgent === 10,
    `sent=${sent} delta=${after.kbdAgent - before.kbdAgent}`,
  );
}

// Criterion 4: clean shutdown.
{
  const before = barrier();
  const kbdOk = UnhookWindowsHookEx(monitor.keyboardHook);
  monitor.keyboardHook = null;
  const mouseOk = UnhookWindowsHookEx(monitor.mouseHook);
  monitor.mouseHook = null;
  check(
    'hooks unhooked cleanly',
    !!kbdOk && !!mouseOk && !monitor.error,
    monitor.error ? `error=${monitor.error}` : `kbd=${!!kbdOk} mouse=${!!mouseOk}`,
  );
  sendInputs([taggedKey(VK_F15, false), taggedKey(VK_F15, true)]);
  await sleep(150);
  check(
    'no callbacks after unhook',
    monitor.kbdAgent === before.kbdAgent,
    `delta=${monitor.kbdAgent - before.kbdAgent}`,
  );
  koffi.unregister(keyboardProc);
  koffi.unregister(mouseProc);
}

console.log('');
if (failures > 0) {
  console.log(`POC RESULT: FAIL (${failures} check(s) failed)`);
  process.exit(1);
} else {
  console.log('POC RESULT: PASS (all four hard-gate criteria verified)');
  process.exit(0);
}
