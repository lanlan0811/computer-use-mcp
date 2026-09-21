/**
 * PhysicalInputMonitor: count every input event except this worker's tagged
 * SendInput.
 *
 * Port of win_helper.py:946-1124, adapted to koffi's constraint that JS
 * callbacks run on the Node main thread (Phase 0 finding). The hooks are
 * installed on the main thread; their callbacks fire inline during
 * PeekMessageW drains and during event-loop awaits. The barrier posts
 * WM_APP_INPUT_BARRIER to our own thread and drains synchronously until that
 * message is retrieved — input events queued earlier have already run their
 * callbacks by then (FIFO), which is exactly the drain-then-read semantics
 * cc-haha gets from its dedicated pump thread.
 */

import * as koffi from 'koffi';
import crypto from 'node:crypto';

import {
  setAgentEventSink,
  type AgentEventSink,
  INPUT_TAG,
} from '../input/inject.js';
import {
  CallNextHookEx,
  GetCurrentThreadId,
  HC_ACTION,
  HOOKPROC,
  LLKHF_INJECTED,
  LLKHF_LOWER_IL_INJECTED,
  LLMHF_INJECTED,
  LLMHF_LOWER_IL_INJECTED,
  PeekMessageW,
  PostThreadMessageW,
  SetWindowsHookExW,
  Sleep,
  UnhookWindowsHookEx,
  WH_KEYBOARD_LL,
  WH_MOUSE_LL,
  WM_APP_INPUT_BARRIER,
  PM_REMOVE,
} from '../win32/lib.js';
import { KBDLLHOOKSTRUCT, MSG, MSLLHOOKSTRUCT } from '../win32/structs.js';

export class InputMonitorUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InputMonitorUnavailable';
  }
}

export class PhysicalInputMonitor implements AgentEventSink {
  private threadId = 0;
  private keyboardHook: bigint | null = null;
  private mouseHook: bigint | null = null;
  private interferenceCount = 0;
  private agentCount = 0;
  private expectedAgentCount = 0;
  private error: Error | null = null;
  private started = false;
  private readonly msgBuf = koffi.alloc(MSG, 1);

  // Registered callbacks must stay strongly referenced for the lifetime of
  // the hooks, or Windows may call freed memory (win_helper.py:960-964).
  private readonly keyboardProc = koffi.register(
    (code: number, wParam: bigint, lParam: bigint) => {
      try {
        if (code === HC_ACTION) {
          const data = koffi.decode(lParam, KBDLLHOOKSTRUCT) as {
            flags: number;
            dwExtraInfo: bigint | number;
          };
          this.record(
            data.flags,
            LLKHF_INJECTED | LLKHF_LOWER_IL_INJECTED,
            data.dwExtraInfo,
          );
        }
      } catch (error) {
        this.error = error instanceof Error ? error : new Error(String(error));
      }
      return CallNextHookEx(null, code, wParam, lParam);
    },
    koffi.pointer(HOOKPROC),
  );

  private readonly mouseProc = koffi.register(
    (code: number, wParam: bigint, lParam: bigint) => {
      try {
        if (code === HC_ACTION) {
          const data = koffi.decode(lParam, MSLLHOOKSTRUCT) as {
            flags: number;
            dwExtraInfo: bigint | number;
          };
          this.record(
            data.flags,
            LLMHF_INJECTED | LLMHF_LOWER_IL_INJECTED,
            data.dwExtraInfo,
          );
        }
      } catch (error) {
        this.error = error instanceof Error ? error : new Error(String(error));
      }
      return CallNextHookEx(null, code, wParam, lParam);
    },
    koffi.pointer(HOOKPROC),
  );

  private record(
    flags: number,
    injectedMask: number,
    extraInfo: bigint | number,
  ): void {
    // koffi decodes uint64 fields as Number when they fit the safe range;
    // normalize before comparing with the BigInt tag.
    const extra = BigInt(extraInfo);
    if ((flags & injectedMask) !== 0 && extra === INPUT_TAG) {
      this.agentCount += 1;
    } else {
      this.interferenceCount += 1;
    }
  }

  /** Install both hooks and create this thread's message queue. */
  start(): void {
    if (this.started) return;
    // Fresh accounting per action: the worker is resident, and a new lease
    // must not inherit the previous action's counters.
    this.interferenceCount = 0;
    this.agentCount = 0;
    this.expectedAgentCount = 0;
    // PeekMessage creates the message queue, which PostThreadMessageW needs
    // (win_helper.py:1011-1016).
    PeekMessageW(this.msgBuf, null, 0, 0, PM_REMOVE);
    this.threadId = Number(GetCurrentThreadId());
    this.keyboardHook = SetWindowsHookExW(
      WH_KEYBOARD_LL,
      this.keyboardProc,
      null,
      0,
    );
    if (!this.keyboardHook) {
      throw new InputMonitorUnavailable(
        `Windows could not install the keyboard input hook (${koffi.errno()})`,
      );
    }
    this.mouseHook = SetWindowsHookExW(WH_MOUSE_LL, this.mouseProc, null, 0);
    if (!this.mouseHook) {
      UnhookWindowsHookEx(this.keyboardHook);
      this.keyboardHook = null;
      throw new InputMonitorUnavailable(
        `Windows could not install the mouse input hook (${koffi.errno()})`,
      );
    }
    this.started = true;
    setAgentEventSink(this);
  }

  /** Account tagged events sent through sendInputs (AgentEventSink). */
  expectAgentEvents(count: number): void {
    this.expectedAgentCount += count;
  }

  /** Re-read this.error (hook callbacks may have set it during the drain). */
  private checkError(): void {
    const error = this.error;
    if (error) {
      throw new InputMonitorUnavailable(
        `Windows physical-input monitoring stopped unexpectedly: ${error.message}`,
      );
    }
  }

  /**
   * Drain earlier hook callbacks and return the physical input count.
   * Synchronous by design: it holds the thread, so libuv cannot consume the
   * barrier message before our own PeekMessageW sees it.
   */
  snapshot(): number {
    this.checkError();
    if (!this.started || !this.threadId) {
      throw new InputMonitorUnavailable(
        'Windows physical-input monitoring is not running; the action result cannot be trusted',
      );
    }
    if (!PostThreadMessageW(this.threadId, WM_APP_INPUT_BARRIER, 0, 0)) {
      throw new InputMonitorUnavailable(
        `Windows could not synchronize physical-input monitoring (${koffi.errno()})`,
      );
    }
    const deadline = Date.now() + 2000;
    for (;;) {
      if (PeekMessageW(this.msgBuf, null, 0, 0, PM_REMOVE)) {
        const decoded = koffi.decode(this.msgBuf, MSG) as {
          message: number;
        };
        if (decoded.message === WM_APP_INPUT_BARRIER) break;
      }
      if (Date.now() > deadline) {
        throw new InputMonitorUnavailable(
          'Windows physical-input monitoring did not respond; the action result cannot be trusted',
        );
      }
      Sleep(1);
    }
    this.checkError();
    if (this.agentCount < this.expectedAgentCount) {
      throw new InputMonitorUnavailable(
        "Windows stopped reporting this worker's tagged input; the action result cannot be trusted",
      );
    }
    return this.interferenceCount;
  }

  /** Unhook and release. Throws InputMonitorUnavailable on failure. */
  stop(): void {
    setAgentEventSink(null);
    if (!this.started) return;
    const mouseOk = this.mouseHook ? UnhookWindowsHookEx(this.mouseHook) : true;
    const kbdOk = this.keyboardHook
      ? UnhookWindowsHookEx(this.keyboardHook)
      : true;
    this.mouseHook = null;
    this.keyboardHook = null;
    this.started = false;
    try {
      koffi.unregister(this.keyboardProc);
      koffi.unregister(this.mouseProc);
    } catch {
      // harmless at teardown
    }
    if (!mouseOk || !kbdOk) {
      throw new InputMonitorUnavailable(
        `Windows could not unhook the input monitor (${koffi.errno()})`,
      );
    }
  }
}

/** Per-process tag source of truth for tests. */
export const _test = {
  INPUT_TAG,
  randomTag: () => BigInt(crypto.randomInt(1, 0xffffffff)),
};
