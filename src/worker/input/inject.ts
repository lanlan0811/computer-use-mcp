/**
 * Input injection: tagged atomic SendInput batches, the damped-spring cursor,
 * and per-character Unicode typing.
 *
 * Every event carries a random 32-bit `dwExtraInfo` tag so the interference
 * monitor can tell this helper's input from the user's (win_helper.py:806-814).
 * Mouse low-level hooks truncate dwExtraInfo to 32 bits on some 64-bit
 * builds, which is exactly why the tag is 32-bit.
 *
 * `_send_inputs` distinguishes refusal degrees: nothing accepted →
 * input_injection_failed; partially accepted →
 * input_injection_result_unknown. SendInput otherwise reports success
 * unconditionally, even when nothing responds (win_helper.py:1153-1174).
 */

import * as koffi from 'koffi';
import crypto from 'node:crypto';

import { normalizeKey } from '../../core/keyMap.js';
import {
  GetAsyncKeyState,
  GetCursorPos,
  GetSystemMetrics,
  INPUT_KEYBOARD,
  INPUT_MOUSE,
  KEYEVENTF_KEYUP,
  KEYEVENTF_UNICODE,
  MapVirtualKeyW,
  MOUSEEVENTF_ABSOLUTE,
  MOUSEEVENTF_LEFTDOWN,
  MOUSEEVENTF_LEFTUP,
  MOUSEEVENTF_MOVE,
  MOUSEEVENTF_MOVE_NOCOALESCE,
  MOUSEEVENTF_VIRTUALDESK,
  SendInput,
  Sleep,
  SM_CXVIRTUALSCREEN,
  SM_XVIRTUALSCREEN,
  SM_CYVIRTUALSCREEN,
  SM_YVIRTUALSCREEN,
  VkKeyScanW,
  keybd_event,
} from '../win32/lib.js';
import { INPUT, POINT } from '../win32/structs.js';

/** One input event, in the JS shape koffi converts to a C INPUT. */
export interface InputEvent {
  type: number;
  u: {
    mi?: {
      dx: number;
      dy: number;
      mouseData: number;
      dwFlags: number;
      time: number;
      dwExtraInfo: bigint;
    };
    ki?: {
      wVk: number;
      wScan: number;
      dwFlags: number;
      time: number;
      dwExtraInfo: bigint;
    };
  };
}

/** Random non-zero 32-bit tag, fixed for the process lifetime. */
export const INPUT_TAG: bigint = BigInt(crypto.randomInt(1, 0xffffffff));

/**
 * The monitor currently guarding an action, set by the lease layer.
 *
 * Mirrors cc-haha's `_active_input_monitor` global: the worker is resident,
 * so tagged-event accounting must reset per action instead of accumulating
 * across the process lifetime (cc-haha spawned one process per command).
 *
 * The sink also pumps the message queue during long blocking sleeps: the
 * main-thread pump architecture (Phase 0) means physical input would
 * otherwise go unobserved — and eventually be dropped by the system — while
 * the worker blocks in a hold duration or a per-character typing loop.
 */
export interface AgentEventSink {
  expectAgentEvents(count: number): void;
  pump(): void;
}

let activeSink: AgentEventSink | null = null;

export function setAgentEventSink(sink: AgentEventSink | null): void {
  activeSink = sink;
}

export class InputInjectionError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'InputInjectionError';
    this.code = code;
  }
}

export function mouseEvent(
  flags: number,
  opts: { data?: number; dx?: number; dy?: number } = {},
): InputEvent {
  return {
    type: INPUT_MOUSE,
    u: {
      mi: {
        dx: opts.dx ?? 0,
        dy: opts.dy ?? 0,
        mouseData: opts.data ?? 0,
        dwFlags: flags,
        time: 0,
        dwExtraInfo: INPUT_TAG,
      },
    },
  };
}

function keyEvent(vk: number, scan: number, flags: number): InputEvent {
  return {
    type: INPUT_KEYBOARD,
    u: {
      ki: {
        wVk: vk,
        wScan: scan,
        dwFlags: flags,
        time: 0,
        dwExtraInfo: INPUT_TAG,
      },
    },
  };
}

/**
 * Insert one atomic, tagged input batch and account for every event.
 * Throws InputInjectionError with the right code on partial/total refusal.
 */
export function sendInputs(events: InputEvent[]): void {
  if (events.length === 0) return;
  // Koffi converts a JS array of struct objects into a C array.
  const sent = SendInput(events.length, events, koffi.sizeof(INPUT));
  activeSink?.expectAgentEvents(sent);
  if (sent !== events.length) {
    if (sent) {
      throw new InputInjectionError(
        `Windows accepted only ${sent} of ${events.length} input events. ` +
          'The result is UNKNOWN; inspect the screen before continuing.',
        'input_injection_result_unknown',
      );
    }
    throw new InputInjectionError(
      'Windows refused the input batch. The target may be elevated or on a ' +
        'secure desktop; nothing was reported as inserted.',
      'input_injection_failed',
    );
  }
}

/** Absolute mouse move mapped into the 0..65535 virtual-desktop space. */
function absoluteMouseMove(x: number, y: number): InputEvent {
  const left = GetSystemMetrics(SM_XVIRTUALSCREEN);
  const top = GetSystemMetrics(SM_YVIRTUALSCREEN);
  const width = GetSystemMetrics(SM_CXVIRTUALSCREEN);
  const height = GetSystemMetrics(SM_CYVIRTUALSCREEN);
  if (width <= 1 || height <= 1) {
    throw new InputInjectionError(
      'Windows did not report a usable virtual desktop.',
      'input_injection_failed',
    );
  }
  const dx = Math.round(((x - left) * 65535) / (width - 1));
  const dy = Math.round(((y - top) * 65535) / (height - 1));
  return mouseEvent(
    MOUSEEVENTF_MOVE |
      MOUSEEVENTF_MOVE_NOCOALESCE |
      MOUSEEVENTF_VIRTUALDESK |
      MOUSEEVENTF_ABSOLUTE,
    { dx, dy },
  );
}

/**
 * Sample the same damped-spring motion the macOS cursor uses
 * (CursorMotionState.swift): k=196, damping ratio 0.85, 60 Hz fixed step,
 * horizontal and vertical integrated independently, terminating when the
 * remaining distance is < 0.5 px and speed < 6.0 px/s
 * (win_helper.py:1199-1239).
 */
export function springCursorPath(
  startX: number,
  startY: number,
  targetX: number,
  targetY: number,
): Array<[number, number]> {
  const distance = Math.hypot(targetX - startX, targetY - startY);
  if (distance < 2) return [[targetX, targetY]];

  const frameInterval = 1.0 / 60.0;
  const stiffness = 196.0;
  const damping = 2.0 * 0.85 * stiffness ** 0.5;
  const maxDuration = Math.min(0.45, Math.max(0.2, distance / 3000.0));
  const sampleCount = Math.max(1, Math.round(maxDuration / frameInterval));

  let posX = startX;
  let posY = startY;
  let velX = 0;
  let velY = 0;
  const points: Array<[number, number]> = [];
  for (let i = 0; i < sampleCount; i += 1) {
    velX += (stiffness * (targetX - posX) - damping * velX) * frameInterval;
    velY += (stiffness * (targetY - posY) - damping * velY) * frameInterval;
    posX += velX * frameInterval;
    posY += velY * frameInterval;
    const point: [number, number] = [Math.round(posX), Math.round(posY)];
    if (points.length === 0 || point !== points[points.length - 1]) {
      points.push(point);
    }
    const remaining = Math.hypot(targetX - posX, targetY - posY);
    const speed = Math.hypot(velX, velY);
    if (remaining < 0.5 && speed < 6.0) break;
  }
  const target: [number, number] = [targetX, targetY];
  if (points.length === 0 || points[points.length - 1] !== target) {
    points.push(target);
  }
  return points;
}

/** Read the cursor position, or null when the call fails. */
export function readCursorPos(): { x: number; y: number } | null {
  const ptr = koffi.alloc(POINT, 1);
  try {
    if (!GetCursorPos(ptr)) return null;
    const point = koffi.decode(ptr, POINT) as { x: number; y: number };
    return { x: point.x, y: point.y };
  } finally {
    koffi.free(ptr);
  }
}

/** Move the shared pointer, optionally along the spring path. */
export function moveCursorTo(x: number, y: number, animate: boolean): void {
  const current = readCursorPos();
  if (current === null) {
    sendInputs([absoluteMouseMove(x, y)]);
    return;
  }
  const startX = current.x;
  const startY = current.y;
  if (!animate) {
    sendInputs([absoluteMouseMove(x, y)]);
    return;
  }
  const points = springCursorPath(startX, startY, x, y);
  const started = performance.now();
  for (const [index, point] of points.entries()) {
    sendInputs([absoluteMouseMove(point[0], point[1])]);
    if (index < points.length - 1) {
      const deadline = started + ((index + 1) / 60.0) * 1000;
      const delay = deadline - performance.now();
      if (delay > 0) sleepPumped(delay);
    }
  }
}

const VIRTUAL_KEYS: Record<string, number> = {
  win: 0x5b,
  ctrl: 0x11,
  shift: 0x10,
  alt: 0x12,
  esc: 0x1b,
  enter: 0x0d,
  tab: 0x09,
  space: 0x20,
  backspace: 0x08,
  delete: 0x2e,
  up: 0x26,
  down: 0x28,
  left: 0x25,
  right: 0x27,
  home: 0x24,
  end: 0x23,
  pageup: 0x21,
  pagedown: 0x22,
  capslock: 0x14,
  ...Object.fromEntries(
    Array.from({ length: 12 }, (_, i) => [`f${i + 1}`, 0x6f + (i + 1)]),
  ),
};

/** VK_HELD scan codes for the held-input report (win_helper.py:1288-1297). */
export const HELD_INPUT_KEYS: Array<[number, string]> = [
  [0x01, 'left mouse button'],
  [0x02, 'right mouse button'],
  [0x04, 'middle mouse button'],
  [0x10, 'Shift'],
  [0x11, 'Control'],
  [0x12, 'Alt'],
  [0x5b, 'left Windows key'],
  [0x5c, 'right Windows key'],
];

/** Resolve one normalized key name to a virtual-key code. */
export function virtualKey(name: string): number {
  if (name === 'fn') {
    throw new Error('The Fn key cannot be synthesized by Windows');
  }
  const known = VIRTUAL_KEYS[name];
  if (known !== undefined) return known;
  if (name.length !== 1) {
    throw new Error(`Unsupported key: ${name}`);
  }
  const mapped = VkKeyScanW(name.charCodeAt(0));
  if (mapped === -1) {
    throw new Error(`The active keyboard layout cannot type key: ${name}`);
  }
  return mapped & 0xff;
}

/** One key event for a normalized key name. */
export function namedKeyInput(
  name: string,
  opts: { keyUp?: boolean } = {},
): InputEvent {
  const vk = virtualKey(name);
  const scan = MapVirtualKeyW(vk, 0);
  return keyEvent(vk, scan, opts.keyUp ? KEYEVENTF_KEYUP : 0);
}

/** KEYEVENTF_UNICODE down/up pair for one UTF-16 code unit. */
function unicodeKeyEvent(codeUnit: number, keyUp: boolean): InputEvent {
  return keyEvent(
    0,
    codeUnit,
    keyUp ? KEYEVENTF_UNICODE | KEYEVENTF_KEYUP : KEYEVENTF_UNICODE,
  );
}

/** Down/up Unicode events for a whole string (UTF-16LE code units). */
export function unicodeInputs(text: string): InputEvent[] {
  const events: InputEvent[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const codeUnit = text.charCodeAt(i);
    events.push(unicodeKeyEvent(codeUnit, false));
    events.push(unicodeKeyEvent(codeUnit, true));
  }
  return events;
}

/** Names of modifier/mouse keys currently held (GetAsyncKeyState). */
export function heldInputs(command: string): string[] {
  const held: string[] = [];
  for (const [vk, name] of HELD_INPUT_KEYS) {
    if (command === 'mouse_up' && vk === 0x01) continue;
    if (GetAsyncKeyState(vk) & 0x8000) held.push(name);
  }
  return held;
}

/**
 * Type text with the win_helper pacing: 25 ms before every character, \r\n
 * collapsed into one Return, \n and \t as real key presses, everything else
 * as KEYEVENTF_UNICODE (win_helper.py:1733-1753). Modern Notepad's RichEdit
 * silently drops or reorders faster Unicode bursts.
 */
export function typeText(text: string, charDelayMs: number): void {
  let index = 0;
  while (index < text.length) {
    const character = text[index]!;
    sleepPumped(charDelayMs);
    if (character === '\r' || character === '\n' || character === '\t') {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      const key = normalizeKey(character === '\t' ? 'tab' : 'return');
      sendInputs([namedKeyInput(key), namedKeyInput(key, { keyUp: true })]);
    } else {
      sendInputs(unicodeInputs(character));
    }
    index += 1;
  }
}

/** Ctrl+V through tagged input (clipboard paste fast path). */
export function pasteClipboard(): void {
  sendInputs([
    namedKeyInput('ctrl'),
    namedKeyInput('v'),
    namedKeyInput('v', { keyUp: true }),
    namedKeyInput('ctrl', { keyUp: true }),
  ]);
}

/** Raw left button down/up without any movement (mouse_down / mouse_up). */
export function leftButtonEvent(down: boolean): InputEvent {
  return mouseEvent(down ? MOUSEEVENTF_LEFTDOWN : MOUSEEVENTF_LEFTUP);
}

/** Test escape hatch: fire a raw untagged legacy event (never in production). */
export function legacyKeybdEvent(vk: number, flags: number): void {
  keybd_event(vk, 0, flags, 0n);
}

/** Chunk size for pumped sleeps: keeps hook timeouts away. */
const PUMP_INTERVAL_MS = 25;

/**
 * Sleep that keeps the input pump alive. Every blocking loop in the worker
 * (hold duration, per-character pacing, spring frames) goes through here so
 * physical input is observed while the action runs.
 */
export function sleepPumped(ms: number): void {
  if (ms <= 0) return;
  const deadline = Date.now() + ms;
  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    Sleep(Math.min(remaining, PUMP_INTERVAL_MS));
    activeSink?.pump();
  }
}

export const _test = {
  mouseEvent,
  keyEvent,
  absoluteMouseMove,
  VIRTUAL_KEYS,
};
