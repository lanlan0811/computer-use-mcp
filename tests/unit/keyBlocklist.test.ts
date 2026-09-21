import { describe, expect, it } from 'vitest';

import {
  isSystemKeyCombo,
  normalizeKeySequence,
} from '../../src/core/keyBlocklist.js';

describe('normalizeKeySequence', () => {
  it('lowercases, aliases, dedupes and orders modifiers', () => {
    expect(normalizeKeySequence('Cmd + Shift + Q')).toBe('shift+meta+q');
    expect(normalizeKeySequence('cmd+command+q')).toBe('meta+q');
    expect(normalizeKeySequence('ctrl+alt+delete')).toBe('ctrl+alt+delete');
  });

  it('keeps non-modifier keys last and in press order', () => {
    expect(normalizeKeySequence('shift+ctrl+a')).toBe('ctrl+shift+a');
  });

  it('canonicalizes key aliases', () => {
    expect(normalizeKeySequence('option+esc')).toBe('alt+escape');
    expect(normalizeKeySequence('spacebar')).toBe('space');
  });
});

describe('isSystemKeyCombo', () => {
  it('hits every blacklisted Windows combo', () => {
    expect(isSystemKeyCombo('ctrl+alt+delete')).toBe(true);
    expect(isSystemKeyCombo('alt+f4')).toBe(true);
    expect(isSystemKeyCombo('alt+tab')).toBe(true);
    expect(isSystemKeyCombo('meta+l')).toBe(true);
    expect(isSystemKeyCombo('meta+d')).toBe(true);
  });

  it('matches by SUBSET: extra modifiers do not bypass the gate', () => {
    // shift+alt+tab still switches windows (reverse).
    expect(isSystemKeyCombo('shift+alt+tab')).toBe(true);
    // An extra harmless modifier on Win+L.
    expect(isSystemKeyCombo('ctrl+meta+l')).toBe(true);
  });

  it('checks each non-modifier key individually: suffix bypass', () => {
    // ctrl+alt is held; Delete fires the SAS before A is ever pressed.
    expect(isSystemKeyCombo('ctrl+alt+delete+a')).toBe(true);
    expect(isSystemKeyCombo('alt+tab+a')).toBe(true);
  });

  it('alias bypasses are caught: super+d and option+f4', () => {
    expect(isSystemKeyCombo('super+d')).toBe(true);
    expect(isSystemKeyCombo('win+l')).toBe(true);
    expect(isSystemKeyCombo('command+d')).toBe(true);
    expect(isSystemKeyCombo('option+f4')).toBe(true);
    expect(isSystemKeyCombo('opt+tab')).toBe(true);
  });

  it('supports multi-chord strings with space separators', () => {
    expect(isSystemKeyCombo('a b alt+tab')).toBe(true);
    expect(isSystemKeyCombo('ctrl+a super+l')).toBe(true);
  });

  it('spaces padding a plus are one chord, not separators', () => {
    expect(isSystemKeyCombo('alt + tab')).toBe(true);
    expect(isSystemKeyCombo('meta + l')).toBe(true);
  });

  it('allows ordinary combos through', () => {
    expect(isSystemKeyCombo('ctrl+shift+tab')).toBe(false);
    expect(isSystemKeyCombo('ctrl+a')).toBe(false);
    expect(isSystemKeyCombo('meta+r')).toBe(false);
    expect(isSystemKeyCombo('enter')).toBe(false);
    // Win+Q is not a Windows-level shortcut (it opens Search harmlessly).
    expect(isSystemKeyCombo('meta+q')).toBe(false);
  });

  it('modifiers-only sequences are not blocked (click modifiers)', () => {
    expect(isSystemKeyCombo('cmd')).toBe(false);
    expect(isSystemKeyCombo('cmd+shift')).toBe(false);
    expect(isSystemKeyCombo('ctrl+alt')).toBe(false);
  });

  it('backspace is NOT an alias of delete (no SAS bypass either way)', () => {
    expect(isSystemKeyCombo('ctrl+alt+backspace')).toBe(false);
  });
});
