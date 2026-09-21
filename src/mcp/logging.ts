/**
 * stderr-only logging. stdout is reserved for the MCP protocol, so every
 * diagnostic line goes to stderr (plan decision 14).
 */

import process from 'node:process';

import type { LogLevel } from '../core/config.js';
import { config } from '../core/config.js';

const LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function write(
  level: LogLevel,
  scope: string,
  message: string,
  ...args: unknown[]
): void {
  if (LEVELS[level] < LEVELS[config.logLevel]) return;
  const suffix =
    args.length > 0
      ? ` ${args.map((a) => (typeof a === 'string' ? a : String(a))).join(' ')}`
      : '';
  process.stderr.write(`[${scope} ${level}] ${message}${suffix}\n`);
}

export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

/** Logger namespaced by component (e.g. "mcp", "worker"). */
export function createLogger(scope: string): Logger {
  return {
    debug: (message, ...args) => write('debug', scope, message, ...args),
    info: (message, ...args) => write('info', scope, message, ...args),
    warn: (message, ...args) => write('warn', scope, message, ...args),
    error: (message, ...args) => write('error', scope, message, ...args),
  };
}

export const logger = createLogger(config.serverName);
