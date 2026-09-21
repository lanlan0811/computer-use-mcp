/**
 * System shortcut blacklist for Windows.
 *
 * Port of cc-haha keyBlocklist.ts (win32 side; the darwin list is dropped —
 * this project is Windows-only). Two properties are security-critical and are
 * preserved exactly:
 *
 *   1. Matching is by SUBSET, not equality. `shift+alt+tab` still switches
 *      windows, so the `alt+tab` entry must hit. Exact-matching would let an
 *      extra modifier walk straight through the gate.
 *   2. Every non-modifier key is checked individually: `cmd+q+a` presses Cmd,
 *      then Q (Cmd+Q fires right there), then A. Comparing the whole joined
 *      string would miss it.
 *
 * Modifier aliases are canonicalized first — without that, `command+q`
 * bypasses a `meta+q` entry.
 */

/**
 * Every modifier alias, mapped to one canonical per physical modifier. Left
 * and right variants collapse — the blocklist does not care which Ctrl.
 */
const CANONICAL_MODIFIER: Readonly<Record<string, string>> = {
  // Win key — "meta"|"super"|"command"|"cmd"|"windows"|"win"
  meta: 'meta',
  meta_l: 'meta',
  meta_r: 'meta',
  super: 'meta',
  super_l: 'meta',
  super_r: 'meta',
  command: 'meta',
  cmd: 'meta',
  windows: 'meta',
  win: 'meta',
  // Control
  ctrl: 'ctrl',
  control: 'ctrl',
  control_l: 'ctrl',
  control_r: 'ctrl',
  lctrl: 'ctrl',
  lcontrol: 'ctrl',
  rctrl: 'ctrl',
  rcontrol: 'ctrl',
  // Shift
  shift: 'shift',
  shift_l: 'shift',
  shift_r: 'shift',
  lshift: 'shift',
  rshift: 'shift',
  // Alt / Option — same physical key on Windows
  alt: 'alt',
  alt_l: 'alt',
  alt_r: 'alt',
  option: 'alt',
  opt: 'alt',
};

/**
 * Non-modifier key aliases. `backspace` is deliberately NOT mapped to
 * `delete` — on Windows they are different keys, and Ctrl+Alt+Backspace is
 * not the Secure Attention Sequence.
 */
const CANONICAL_KEY: Readonly<Record<string, string>> = {
  esc: 'escape',
  spacebar: 'space',
  del: 'delete',
  forwarddelete: 'delete',
  forward_delete: 'delete',
  deletef: 'delete',
};

/** Sort order for canonicals. ctrl < alt < shift < meta. */
const MODIFIER_ORDER = ['ctrl', 'alt', 'shift', 'meta'];

/**
 * Canonical-form entries only. Every modifier is a CANONICAL_MODIFIER value,
 * modifiers in MODIFIER_ORDER, non-modifier last.
 */
const BLOCKED_WIN32: ReadonlySet<string> = new Set([
  'ctrl+alt+delete', // Secure Attention Sequence
  'alt+f4', // close window
  'alt+tab', // window switcher
  'meta+l', // Win+L — lock
  'meta+d', // Win+D — show desktop
]);

/** Partition into sorted-canonical modifiers and non-modifier keys. */
function partitionKeys(seq: string): { mods: string[]; keys: string[] } {
  const parts = seq
    .toLowerCase()
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean);
  const mods: string[] = [];
  const keys: string[] = [];
  for (const p of parts) {
    const canonical = CANONICAL_MODIFIER[p];
    if (canonical !== undefined) {
      mods.push(canonical);
    } else {
      keys.push(CANONICAL_KEY[p] ?? p);
    }
  }
  // Dedupe: "cmd+command+q" → "meta+q", not "meta+meta+q".
  const uniqueMods = [...new Set(mods)];
  uniqueMods.sort(
    (a, b) => MODIFIER_ORDER.indexOf(a) - MODIFIER_ORDER.indexOf(b),
  );
  return { mods: uniqueMods, keys };
}

/** Normalize "Cmd + Shift + Q" → "shift+meta+q". */
export function normalizeKeySequence(seq: string): string {
  const { mods, keys } = partitionKeys(seq);
  return [...mods, ...keys].join('+');
}

/** A blocklist entry split into the modifiers it needs and the key it fires. */
interface BlockedChord {
  mods: string[];
  key: string;
}

/** Parse the canonical-form blocklist strings once, at module load. */
function parseBlocklist(entries: ReadonlySet<string>): BlockedChord[] {
  const chords: BlockedChord[] = [];
  for (const entry of entries) {
    const { mods, keys } = partitionKeys(entry);
    // Every entry is "<mods…>+<one key>"; a modifier-only entry has no chord
    // to fire and is skipped rather than silently matching everything.
    if (keys.length === 1) chords.push({ mods, key: keys[0]! });
  }
  return chords;
}

const BLOCKED_WIN32_CHORDS = parseBlocklist(BLOCKED_WIN32);

/**
 * Split a request into the chords it will actually press.
 *
 * Two spellings collide and both must work:
 *   "cmd + q"                    → ONE chord (spaces padding a `+`)
 *   "super+a cmd+opt+esc ctrl+v" → THREE chords (spaces separating them)
 *
 * Collapsing whitespace around `+` first disambiguates them: after that, any
 * remaining whitespace is a chord separator.
 */
function splitChords(seq: string): string[] {
  return seq
    .replace(/\s*\+\s*/g, '+')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * True if the sequence would fire a blocked Windows shortcut.
 *
 * A modifiers-only sequence ("cmd+shift", e.g. click modifiers) has no key to
 * pair with and falls through to false.
 */
export function isSystemKeyCombo(seq: string): boolean {
  for (const chord of splitChords(seq)) {
    const { mods, keys } = partitionKeys(chord);
    if (keys.length === 0) continue;
    const held = new Set(mods);
    for (const blocked of BLOCKED_WIN32_CHORDS) {
      if (!blocked.mods.every((mod) => held.has(mod))) continue;
      if (keys.includes(blocked.key)) return true;
    }
  }
  return false;
}

export const _test = {
  CANONICAL_MODIFIER,
  CANONICAL_KEY,
  BLOCKED_WIN32,
  MODIFIER_ORDER,
};
