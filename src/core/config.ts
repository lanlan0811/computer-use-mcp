/**
 * Frozen-at-startup configuration.
 *
 * Every knob is read once from the environment and frozen: a mid-session
 * change would silently desynchronize the model-facing descriptions from the
 * runtime behavior (the exact failure the coordinate-mode freeze prevents).
 * `COMPUTER_USE_` prefix everywhere (plan §8).
 */

import { tmpdir } from 'node:os';

import type { ResizeParams } from './imageBudget.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface CuConfig {
  /** Master switch: true → every tool refuses. */
  disabled: boolean;
  /** Grant flag: system shortcut blacklist enforcement. */
  allowSystemKeys: boolean;
  /** Grant flag: clipboard read. */
  allowClipboardRead: boolean;
  /** Grant flag: clipboard write. */
  allowClipboardWrite: boolean;
  /** Stale click-target pixel validation (default off). */
  pixelValidation: boolean;
  /** Grid size for pixel validation (9×9 default). */
  pixelValidationGrid: number;
  /** Damped-spring cursor animation. */
  mouseAnimation: boolean;
  /** Extra settle time before observing (default 0 — no fixed waits). */
  settleMs: number;
  /** Per-action hard timeout. */
  actionTimeoutMs: number;
  /** Installed-app list TTL cache. */
  appCacheTtlMs: number;
  /** Worker idle shutdown. */
  workerIdleMs: number;
  /** Directory for save_to_disk screenshots. */
  shotDir: string;
  /** MCP server name (controls the client-side tool prefix). */
  serverName: string;
  /** stderr log level. */
  logLevel: LogLevel;

  /** Image budget constants — not configurable, kept identical to cc-haha. */
  imageBudget: ResizeParams;
  /** JPEG quality for screenshots. */
  screenshotJpegQuality: number;
  /** Settle delay after a cursor move, before the next event (worker). */
  moveSettleMs: number;
  /** Delay before each typed character (worker; win_helper.py pacing). */
  typeCharDelayMs: number;
  /** Spring animation stiffness (worker). */
  springStiffness: number;
  /** Spring animation damping ratio (worker). */
  springDampingRatio: number;
  /** Spring animation frame rate (worker). */
  springFrameRateHz: number;
  /** Screenshot retry threshold in decoded bytes. */
  minScreenshotBytes: number;
}

/** cc-haha bool_env: unset → default; "0"/"false"/"False"/"" → false. */
function boolEnv(
  env: Record<string, string | undefined>,
  name: string,
  defaultValue: boolean,
): boolean {
  const value = env[name];
  if (value === undefined) return defaultValue;
  return (
    value !== '0' && value !== 'false' && value !== 'False' && value !== ''
  );
}

function intEnv(
  env: Record<string, string | undefined>,
  name: string,
  defaultValue: number,
): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return defaultValue;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

const LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];

function logLevelEnv(
  env: Record<string, string | undefined>,
  name: string,
  defaultValue: LogLevel,
): LogLevel {
  const raw = env[name]?.trim().toLowerCase();
  return (LOG_LEVELS as readonly string[]).includes(raw ?? '')
    ? (raw as LogLevel)
    : defaultValue;
}

/** Default shot dir: %TEMP%\computer-use-mcp, falling back to os.tmpdir(). */
function defaultShotDir(env: Record<string, string | undefined>): string {
  if (env.COMPUTER_USE_SHOT_DIR && env.COMPUTER_USE_SHOT_DIR.trim() !== '') {
    return env.COMPUTER_USE_SHOT_DIR;
  }
  const base = env.TEMP ?? env.TMP ?? tmpdir();
  return `${base}\\computer-use-mcp`;
}

/**
 * Per-action hard timeout. The plan leaves the value "to be measured"; until
 * the Phase 5 desktop runs pin it down, 30s covers the slowest observed
 * action (a full-screen type with per-character pacing).
 */
const DEFAULT_ACTION_TIMEOUT_MS = 30000;

/** Deep-freeze so nested records (imageBudget) cannot be mutated either. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      deepFreeze(nested);
    }
    return Object.freeze(value);
  }
  return value;
}

export function loadConfig(env: Record<string, string | undefined>): CuConfig {
  const config: CuConfig = {
    disabled: boolEnv(env, 'COMPUTER_USE_DISABLED', false),
    allowSystemKeys: boolEnv(env, 'COMPUTER_USE_ALLOW_SYSTEM_KEYS', true),
    allowClipboardRead: boolEnv(env, 'COMPUTER_USE_ALLOW_CLIPBOARD_READ', true),
    allowClipboardWrite: boolEnv(
      env,
      'COMPUTER_USE_ALLOW_CLIPBOARD_WRITE',
      true,
    ),
    pixelValidation: boolEnv(env, 'COMPUTER_USE_PIXEL_VALIDATION', false),
    pixelValidationGrid: intEnv(env, 'COMPUTER_USE_PIXEL_VALIDATION_GRID', 9),
    mouseAnimation: boolEnv(env, 'COMPUTER_USE_MOUSE_ANIMATION', true),
    settleMs: intEnv(env, 'COMPUTER_USE_SETTLE_MS', 0),
    actionTimeoutMs: intEnv(
      env,
      'COMPUTER_USE_ACTION_TIMEOUT_MS',
      DEFAULT_ACTION_TIMEOUT_MS,
    ),
    appCacheTtlMs: intEnv(env, 'COMPUTER_USE_APP_CACHE_TTL_MS', 60000),
    workerIdleMs: intEnv(env, 'COMPUTER_USE_WORKER_IDLE_MS', 300000),
    shotDir: defaultShotDir(env),
    serverName: env.COMPUTER_USE_SERVER_NAME ?? 'computer-use',
    logLevel: logLevelEnv(env, 'COMPUTER_USE_LOG_LEVEL', 'info'),

    imageBudget: {
      pxPerToken: 28,
      maxTargetPx: 1568,
      maxTargetTokens: 1568,
    },
    screenshotJpegQuality: 0.75,
    moveSettleMs: 50,
    typeCharDelayMs: 25,
    springStiffness: 196,
    springDampingRatio: 0.85,
    springFrameRateHz: 60,
    minScreenshotBytes: 1024,
  };
  return deepFreeze(config);
}

/** The startup-frozen configuration for this process. */
export const config: CuConfig = loadConfig(process.env);
