/**
 * Key vocabulary. Strict port of cc-haha runtime/win_helper.py KEY_MAP
 * (lines 98-152): the Windows executor's accepted spellings, with the macOS
 * modifier names mapped to their Windows equivalents ("cmd"/"command"/"meta"/
 * "super" → the Windows key).
 */

export const KEY_MAP: Readonly<Record<string, string>> = {
  a: 'a',
  b: 'b',
  c: 'c',
  d: 'd',
  e: 'e',
  f: 'f',
  g: 'g',
  h: 'h',
  i: 'i',
  j: 'j',
  k: 'k',
  l: 'l',
  m: 'm',
  n: 'n',
  o: 'o',
  p: 'p',
  q: 'q',
  r: 'r',
  s: 's',
  t: 't',
  u: 'u',
  v: 'v',
  w: 'w',
  x: 'x',
  y: 'y',
  z: 'z',
  '0': '0',
  '1': '1',
  '2': '2',
  '3': '3',
  '4': '4',
  '5': '5',
  '6': '6',
  '7': '7',
  '8': '8',
  '9': '9',
  // Modifier keys — macOS names map to Windows equivalents.
  cmd: 'win',
  command: 'win',
  meta: 'win',
  super: 'win',
  ctrl: 'ctrl',
  control: 'ctrl',
  shift: 'shift',
  alt: 'alt',
  option: 'alt',
  opt: 'alt',
  fn: 'fn',
  // Navigation / editing
  escape: 'esc',
  esc: 'esc',
  enter: 'enter',
  return: 'enter',
  tab: 'tab',
  space: 'space',
  backspace: 'backspace',
  delete: 'delete',
  forwarddelete: 'delete',
  up: 'up',
  down: 'down',
  left: 'left',
  right: 'right',
  home: 'home',
  end: 'end',
  pageup: 'pageup',
  pagedown: 'pagedown',
  capslock: 'capslock',
  // Function keys
  f1: 'f1',
  f2: 'f2',
  f3: 'f3',
  f4: 'f4',
  f5: 'f5',
  f6: 'f6',
  f7: 'f7',
  f8: 'f8',
  f9: 'f9',
  f10: 'f10',
  f11: 'f11',
  f12: 'f12',
  // Symbols
  '-': '-',
  '=': '=',
  '[': '[',
  ']': ']',
  '\\': '\\',
  ';': ';',
  "'": "'",
  ',': ',',
  '.': '.',
  '/': '/',
  '`': '`',
};

/** Normalize one key name through KEY_MAP; throws on unsupported spellings. */
export function normalizeKey(name: string): string {
  const key = name.trim().toLowerCase();
  const mapped = KEY_MAP[key];
  if (mapped === undefined) {
    throw new Error(`Unsupported key: ${name}`);
  }
  return mapped;
}
