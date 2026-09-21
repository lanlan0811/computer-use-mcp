/**
 * Composed input actions: click variants, scroll, drag, key, hold.
 *
 * Mirrors win_helper.py:1661-1751 exactly — order of modifier presses,
 * click counts, wheel deltas, and the repeat pacing are all battle-tested.
 */

import { normalizeKey } from '../../core/keyMap.js';
import {
  MOUSEEVENTF_HWHEEL,
  MOUSEEVENTF_LEFTDOWN,
  MOUSEEVENTF_LEFTUP,
  MOUSEEVENTF_MIDDLEDOWN,
  MOUSEEVENTF_MIDDLEUP,
  MOUSEEVENTF_RIGHTDOWN,
  MOUSEEVENTF_RIGHTUP,
  MOUSEEVENTF_WHEEL,
  Sleep,
  WHEEL_DELTA,
} from '../win32/lib.js';
import {
  mouseEvent,
  moveCursorTo,
  namedKeyInput,
  readCursorPos,
  sendInputs,
  sleepPumped,
  type InputEvent,
} from './inject.js';

const BUTTON_FLAGS = {
  left: [MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP] as const,
  right: [MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP] as const,
  middle: [MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP] as const,
};

export function click(
  x: number,
  y: number,
  button: 'left' | 'right' | 'middle',
  count: number,
  modifiers: string[] | undefined,
  animate: boolean,
): void {
  const flags = BUTTON_FLAGS[button];
  if (!flags) throw new Error(`Unsupported mouse button: ${button}`);
  const normalized = (modifiers ?? []).map(normalizeKey);
  const [downFlag, upFlag] = flags;
  moveCursorTo(x, y, animate);
  const events: InputEvent[] = [];
  events.push(...normalized.map((key) => namedKeyInput(key)));
  for (let i = 0; i < Math.max(1, count); i += 1) {
    events.push(mouseEvent(downFlag));
    events.push(mouseEvent(upFlag));
  }
  events.push(
    ...[...normalized]
      .reverse()
      .map((key) => namedKeyInput(key, { keyUp: true })),
  );
  sendInputs(events);
}

export function scroll(
  x: number,
  y: number,
  deltaX: number,
  deltaY: number,
  animate: boolean,
): void {
  moveCursorTo(x, y, animate);
  const events: InputEvent[] = [];
  if (deltaY) {
    events.push(mouseEvent(MOUSEEVENTF_WHEEL, { data: deltaY * WHEEL_DELTA }));
  }
  if (deltaX) {
    events.push(mouseEvent(MOUSEEVENTF_HWHEEL, { data: deltaX * WHEEL_DELTA }));
  }
  sendInputs(events);
}

/** Press, move to target, release. `from` omitted → drag from the cursor. */
export function drag(
  from: { x: number; y: number } | undefined,
  to: { x: number; y: number },
  animate: boolean,
): void {
  if (from !== undefined) {
    moveCursorTo(from.x, from.y, animate);
  } else {
    const current = readCursorPos();
    if (current === null) {
      // No readable cursor position: fall back to a teleport to the target so
      // the button press lands somewhere defined.
      moveCursorTo(to.x, to.y, false);
    }
  }
  sendInputs([mouseEvent(MOUSEEVENTF_LEFTDOWN)]);
  moveCursorTo(to.x, to.y, animate);
  sendInputs([mouseEvent(MOUSEEVENTF_LEFTUP)]);
}

/** Press a chord (press each key in order, release in reverse), with repeat. */
export function keyAction(sequence: string, repeat: number): void {
  const parts = sequence
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)
    .map(normalizeKey);
  for (let i = 0; i < Math.max(1, repeat); i += 1) {
    const events: InputEvent[] = parts.map((key) => namedKeyInput(key));
    events.push(
      ...[...parts].reverse().map((key) => namedKeyInput(key, { keyUp: true })),
    );
    sendInputs(events);
    Sleep(10);
  }
}

/** Hold every key, sleep, release in reverse order (win_helper.py:1721-1730). */
export function holdKeys(keys: string[], durationMs: number): void {
  const normalized = keys.map(normalizeKey);
  sendInputs(normalized.map((key) => namedKeyInput(key)));
  try {
    sleepPumped(Math.max(durationMs, 0));
  } finally {
    sendInputs(
      [...normalized]
        .reverse()
        .map((key) => namedKeyInput(key, { keyUp: true })),
    );
  }
}
