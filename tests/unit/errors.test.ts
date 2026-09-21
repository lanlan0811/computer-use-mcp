import { describe, expect, it } from 'vitest';

import {
  CuToolError,
  formatToolErrorText,
  toolError,
  toolText,
} from '../../src/core/errors.js';

describe('tool error shaping', () => {
  it('prefixes the machine-readable code', () => {
    expect(formatToolErrorText('user_interference', 'user moved mouse')).toBe(
      'user_interference: user moved mouse',
    );
  });

  it('builds an isError result the model can parse mechanically', () => {
    const result = toolError(
      'user_interference_result_unknown',
      'input may have landed',
    );
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      {
        type: 'text',
        text: 'user_interference_result_unknown: input may have landed',
      },
    ]);
  });

  it('plain text results are not errors', () => {
    const result = toolText('Clicked.');
    expect(result.content).toEqual([{ type: 'text', text: 'Clicked.' }]);
    expect('isError' in result).toBe(false);
  });

  it('CuToolError carries its code', () => {
    const err = new CuToolError('point_outside_display', 'off screen');
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('point_outside_display');
    expect(err.message).toBe('off screen');
  });
});
