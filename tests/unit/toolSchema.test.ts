import { describe, expect, it } from 'vitest';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

import {
  BATCHABLE_ACTIONS,
  buildComputerUseTools,
} from '../../src/core/toolSchema.js';
import { OUR_TOOL_NAMES } from '../../src/core/toolNames.js';

interface PropSchema {
  type?: string;
  enum?: string[];
  items?: { properties?: Record<string, PropSchema>; type?: string };
  minimum?: number;
  maximum?: number;
  minItems?: number;
  description?: string;
  properties?: Record<string, PropSchema>;
  required?: string[];
}

const tools = buildComputerUseTools();

function tool(name: string): Tool {
  const found = tools.find((t) => t.name === name);
  if (!found) throw new Error(`tool not found: ${name}`);
  return found;
}

function schemaOf(name: string): PropSchema {
  return tool(name).inputSchema as unknown as PropSchema;
}

function prop(name: string, key: string): PropSchema {
  const schema = schemaOf(name);
  const found = schema.properties?.[key];
  if (!found) throw new Error(`property not found: ${name}.${key}`);
  return found;
}

describe('buildComputerUseTools', () => {
  it('advertises exactly the 22 tools, in order', () => {
    expect(tools.map((t) => t.name)).toEqual([...OUR_TOOL_NAMES]);
    expect(tools).toHaveLength(22);
  });

  it('has unique names and non-empty descriptions', () => {
    const names = new Set(tools.map((t) => t.name));
    expect(names.size).toBe(22);
    for (const t of tools) {
      expect((t.description ?? '').length).toBeGreaterThan(10);
    }
  });

  it('every tool has an object inputSchema with required array', () => {
    for (const t of tools) {
      const schema = t.inputSchema as unknown as PropSchema;
      expect(schema.type).toBe('object');
      expect(Array.isArray(schema.required)).toBe(true);
      for (const req of schema.required ?? []) {
        expect(schema.properties).toHaveProperty(req);
      }
    }
  });

  it('coordinate tools require a [x, y] tuple', () => {
    for (const name of [
      'click',
      'double_click',
      'triple_click',
      'right_click',
      'middle_click',
      'scroll',
      'drag',
      'move_mouse',
    ]) {
      expect(prop(name, 'coordinate').type).toBe('array');
      expect(schemaOf(name).required).toContain('coordinate');
    }
  });

  it('scroll requires direction and amount with the documented ranges', () => {
    expect(prop('scroll', 'scroll_direction').enum).toEqual([
      'up',
      'down',
      'left',
      'right',
    ]);
    expect(prop('scroll', 'scroll_amount').minimum).toBe(0);
    expect(prop('scroll', 'scroll_amount').maximum).toBe(100);
  });

  it('batch action enum matches the batchable set', () => {
    const actions = prop('batch', 'actions');
    expect(actions.minItems).toBe(1);
    const enumValues = actions.items?.properties?.action?.enum ?? [];
    expect(new Set(enumValues)).toEqual(new Set(BATCHABLE_ACTIONS));
  });

  it('freezes coordinate descriptions to pixels mode', () => {
    const descriptions = tools
      .flatMap((t) =>
        Object.values(
          (t.inputSchema as unknown as PropSchema).properties ?? {},
        ),
      )
      .map((p) => p.description ?? '')
      .join('\n');
    expect(descriptions).toContain('measured from the left edge');
    expect(descriptions).not.toContain('percentage of screen width');
  });

  it('gives wait/hold_key/press_key their documented bounds', () => {
    // cc-haha's wait/hold_key duration carries the range in prose only; the
    // 0..100 bound is enforced by validation, not the schema.
    expect(prop('wait', 'duration').description).toContain('0–100');
    expect(schemaOf('hold_key').required).toEqual(['text', 'duration']);
    expect(prop('press_key', 'repeat').maximum).toBe(100);
  });

  it('read-only tools take no arguments', () => {
    for (const name of [
      'read_clipboard',
      'cursor_position',
      'mouse_down',
      'mouse_up',
    ]) {
      expect(schemaOf(name).required).toEqual([]);
      expect(Object.keys(schemaOf(name).properties ?? {})).toEqual([]);
    }
  });
});
