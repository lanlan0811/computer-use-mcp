import { describe, expect, it } from 'vitest';

import { KEY_MAP, normalizeKey } from '../../src/core/keyMap.js';

describe('normalizeKey', () => {
  it('passes through letters, digits and symbols', () => {
    expect(normalizeKey('a')).toBe('a');
    expect(normalizeKey('Z')).toBe('z');
    expect(normalizeKey('7')).toBe('7');
    expect(normalizeKey('-')).toBe('-');
    expect(normalizeKey('\\')).toBe('\\');
  });

  it('maps macOS modifier spellings to the Windows key', () => {
    expect(normalizeKey('cmd')).toBe('win');
    expect(normalizeKey('command')).toBe('win');
    expect(normalizeKey('meta')).toBe('win');
    expect(normalizeKey('super')).toBe('win');
  });

  it('maps alt spellings and navigation aliases', () => {
    expect(normalizeKey('option')).toBe('alt');
    expect(normalizeKey('opt')).toBe('alt');
    expect(normalizeKey('control')).toBe('ctrl');
    expect(normalizeKey('return')).toBe('enter');
    expect(normalizeKey('esc')).toBe('esc');
    expect(normalizeKey('escape')).toBe('esc');
    expect(normalizeKey('forwarddelete')).toBe('delete');
  });

  it('trims and lowercases before lookup', () => {
    expect(normalizeKey('  Cmd  ')).toBe('win');
  });

  it('throws on unsupported keys', () => {
    expect(() => normalizeKey('f13')).toThrow(/Unsupported key/);
    expect(() => normalizeKey('insert')).toThrow(/Unsupported key/);
  });

  it('covers f1-f12', () => {
    for (const fn of [
      'f1',
      'f2',
      'f3',
      'f4',
      'f5',
      'f6',
      'f7',
      'f8',
      'f9',
      'f10',
      'f11',
      'f12',
    ]) {
      expect(KEY_MAP[fn]).toBe(fn);
    }
  });
});
