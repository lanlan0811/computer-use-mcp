/**
 * Snapshot contract test: the advertised tool list must stay structurally
 * identical to cc-haha's authoritative definitions, modulo the tool-name
 * mapping (the only allowed transformation).
 *
 * The snapshot is generated LOCALLY by scripts/extract-tool-snapshots.mjs
 * (cc-haha is not available in CI); this test only compares the shipped list
 * against the committed snapshot. Any drift turns CI red, so a deviation has
 * to be an explicit, reviewed change — never a silent one.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { buildComputerUseTools } from '../../src/core/toolSchema.js';

interface NormalizedTool {
  name: string;
  ccHahaName: string;
  inputSchema: unknown;
}

interface Snapshot {
  coordinateMode: string;
  platform: string;
  toolCount: number;
  tools: NormalizedTool[];
}

const snapshot = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL('./__snapshots__/cc-haha-tools.json', import.meta.url),
    ),
    'utf8',
  ),
) as Snapshot;

/** Same normalization the extract script applies (descriptions dropped). */
function normalizeSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(normalizeSchema);
  if (node !== null && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(
      node as Record<string, unknown>,
    )) {
      if (key === 'description') continue;
      if (key === 'enum' && Array.isArray(value)) {
        out[key] = [...(value as unknown[])].sort();
        continue;
      }
      out[key] = normalizeSchema(value);
    }
    return out;
  }
  return node;
}

const actual = buildComputerUseTools()
  .map((tool) => ({
    name: tool.name,
    inputSchema: normalizeSchema(tool.inputSchema),
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

const expected = snapshot.tools.map((tool) => ({
  name: tool.name,
  inputSchema: normalizeSchema(tool.inputSchema),
}));

describe('tool schema contract against cc-haha', () => {
  it('snapshot records the frozen platform and coordinate mode', () => {
    expect(snapshot.platform).toBe('win32');
    expect(snapshot.coordinateMode).toBe('pixels');
    expect(snapshot.toolCount).toBe(22);
  });

  it('advertises exactly the snapshot tool count', () => {
    expect(actual).toHaveLength(snapshot.tools.length);
  });

  it('every snapshot tool exists with an identical schema structure', () => {
    for (const expectedTool of expected) {
      const actualTool = actual.find((t) => t.name === expectedTool.name);
      expect(actualTool, `missing tool: ${expectedTool.name}`).toBeDefined();
      expect(
        actualTool!.inputSchema,
        `schema drift for tool: ${expectedTool.name}`,
      ).toEqual(expectedTool.inputSchema);
    }
  });

  it('advertises no tool the snapshot does not know', () => {
    const expectedNames = new Set(expected.map((t) => t.name));
    for (const actualTool of actual) {
      expect(expectedNames.has(actualTool.name)).toBe(true);
    }
  });
});
