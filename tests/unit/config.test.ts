import { describe, expect, it } from 'vitest';

import { loadConfig } from '../../src/core/config.js';

const baseEnv: Record<string, string | undefined> = {};

describe('loadConfig', () => {
  it('defaults match the plan (grants on, validation off)', () => {
    const c = loadConfig(baseEnv);
    expect(c.disabled).toBe(false);
    expect(c.allowSystemKeys).toBe(true);
    expect(c.allowClipboardRead).toBe(true);
    expect(c.allowClipboardWrite).toBe(true);
    expect(c.pixelValidation).toBe(false);
    expect(c.pixelValidationGrid).toBe(9);
    expect(c.mouseAnimation).toBe(true);
    expect(c.settleMs).toBe(0);
    expect(c.appCacheTtlMs).toBe(60000);
    expect(c.workerIdleMs).toBe(300000);
    expect(c.serverName).toBe('computer-use');
    expect(c.logLevel).toBe('info');
  });

  it('honors the kill switch', () => {
    const c = loadConfig({ ...baseEnv, COMPUTER_USE_DISABLED: '1' });
    expect(c.disabled).toBe(true);
  });

  it('parses grant flags with cc-haha bool_env semantics', () => {
    expect(
      loadConfig({ ...baseEnv, COMPUTER_USE_ALLOW_SYSTEM_KEYS: '0' })
        .allowSystemKeys,
    ).toBe(false);
    expect(
      loadConfig({ ...baseEnv, COMPUTER_USE_ALLOW_SYSTEM_KEYS: 'false' })
        .allowSystemKeys,
    ).toBe(false);
    expect(
      loadConfig({ ...baseEnv, COMPUTER_USE_ALLOW_SYSTEM_KEYS: '' })
        .allowSystemKeys,
    ).toBe(false);
    expect(
      loadConfig({ ...baseEnv, COMPUTER_USE_ALLOW_SYSTEM_KEYS: '1' })
        .allowSystemKeys,
    ).toBe(true);
  });

  it('reads numeric knobs and ignores garbage', () => {
    const c = loadConfig({
      ...baseEnv,
      COMPUTER_USE_PIXEL_VALIDATION: '1',
      COMPUTER_USE_PIXEL_VALIDATION_GRID: '5',
      COMPUTER_USE_SETTLE_MS: '250',
      COMPUTER_USE_APP_CACHE_TTL_MS: '1000',
      COMPUTER_USE_ACTION_TIMEOUT_MS: 'not-a-number',
    });
    expect(c.pixelValidation).toBe(true);
    expect(c.pixelValidationGrid).toBe(5);
    expect(c.settleMs).toBe(250);
    expect(c.appCacheTtlMs).toBe(1000);
    expect(c.actionTimeoutMs).toBe(30000);
  });

  it('logs level falls back to info on garbage', () => {
    expect(
      loadConfig({ ...baseEnv, COMPUTER_USE_LOG_LEVEL: 'loud' }).logLevel,
    ).toBe('info');
    expect(
      loadConfig({ ...baseEnv, COMPUTER_USE_LOG_LEVEL: 'DEBUG' }).logLevel,
    ).toBe('debug');
  });

  it('shot dir: env override, then TEMP, then tmpdir', () => {
    expect(
      loadConfig({ ...baseEnv, COMPUTER_USE_SHOT_DIR: 'D:\\shots' }).shotDir,
    ).toBe('D:\\shots');
    expect(loadConfig({ ...baseEnv, TEMP: 'C:\\Temp' }).shotDir).toBe(
      'C:\\Temp\\computer-use-mcp',
    );
    expect(loadConfig(baseEnv).shotDir).toMatch(/computer-use-mcp$/);
  });

  it('freezes the returned config', () => {
    const c = loadConfig(baseEnv);
    expect(Object.isFrozen(c)).toBe(true);
    expect(Object.isFrozen(c.imageBudget)).toBe(true);
  });

  it('keeps image budget constants identical to cc-haha', () => {
    const c = loadConfig(baseEnv);
    expect(c.imageBudget).toEqual({
      pxPerToken: 28,
      maxTargetPx: 1568,
      maxTargetTokens: 1568,
    });
    expect(c.screenshotJpegQuality).toBe(0.75);
    expect(c.moveSettleMs).toBe(50);
    expect(c.typeCharDelayMs).toBe(25);
    expect(c.springStiffness).toBe(196);
    expect(c.springDampingRatio).toBe(0.85);
    expect(c.springFrameRateHz).toBe(60);
    expect(c.minScreenshotBytes).toBe(1024);
  });
});
