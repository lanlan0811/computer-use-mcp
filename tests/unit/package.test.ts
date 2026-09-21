import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const pkg = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../package.json', import.meta.url)),
    'utf8',
  ),
) as {
  name: string;
  version: string;
  type: string;
  engines: { node: string };
  files: string[];
  os?: string;
  bin: Record<string, string>;
  dependencies: Record<string, string>;
};

describe('package metadata', () => {
  it('uses the scoped package name', () => {
    expect(pkg.name).toBe('@lotteai/computer-use');
  });

  it('is ESM-only', () => {
    expect(pkg.type).toBe('module');
  });

  it('requires Node >= 20', () => {
    expect(pkg.engines.node).toBe('>=20');
  });

  it('has no os field (postinstall self-check handles platform)', () => {
    expect(pkg.os).toBeUndefined();
  });

  it('exposes the computer-use bin pointing at dist/index.js', () => {
    expect(pkg.bin['computer-use']).toBe('dist/index.js');
  });

  it('publishes a whitelist without sourcemaps', () => {
    expect(pkg.files).toContain('dist/');
    expect(pkg.files.some((f) => f.endsWith('.map'))).toBe(false);
  });

  it('depends only on the runtime trio (sdk, koffi, sharp)', () => {
    expect(Object.keys(pkg.dependencies).sort()).toEqual([
      '@modelcontextprotocol/sdk',
      'koffi',
      'sharp',
    ]);
  });
});
