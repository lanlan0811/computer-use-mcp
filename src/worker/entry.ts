/**
 * Worker entry: the resident child process that owns every Win32 call.
 *
 * Protocol (see protocol.ts): one JSON request per stdin line, one JSON
 * response per stdout line. stdout carries the protocol ONLY — diagnostics go
 * to stderr. stdin EOF shuts the worker down.
 *
 * The worker exists so an FFI access violation cannot take down the MCP
 * server, and so the native message pump lives in its own process
 * (plan §5.1-5.3).
 */

import process from 'node:process';

import { config } from '../core/config.js';
import { errorCodeOf, executeAction } from './actions.js';
import {
  PROTOCOL_VERSION,
  LineFramer,
  ProtocolError,
  decodeRequest,
  encodeResponse,
  errorResponse,
  okResponse,
} from './protocol.js';
import { assertStructLayouts } from './win32/structs.js';
import { enablePerMonitorDpiAwareness } from './win32/dpi.js';

const LEVELS: Record<string, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function log(
  level: 'debug' | 'info' | 'warn' | 'error',
  message: string,
): void {
  if (LEVELS[level]! < LEVELS[config.logLevel]!) return;
  process.stderr.write(`[computer-use-worker ${level}] ${message}\n`);
}

async function main(): Promise<void> {
  // DPI awareness MUST be forced before any capture or coordinate math.
  enablePerMonitorDpiAwareness();
  assertStructLayouts();
  log('info', `worker up (protocol v${PROTOCOL_VERSION}, pid ${process.pid})`);

  const framer = new LineFramer();
  let pending = Promise.resolve();

  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => {
    for (const line of framer.push(chunk)) {
      const request = (() => {
        try {
          return decodeRequest(line);
        } catch (error) {
          if (error instanceof ProtocolError) {
            process.stdout.write(
              `${encodeResponse(errorResponse(-1, 'bad_args', error.message))}\n`,
            );
            return null;
          }
          throw error;
        }
      })();
      if (request === null) continue;
      // Serialize execution: one action at a time keeps the lease and the
      // interference monitor coherent.
      pending = pending.then(async () => {
        const started = Date.now();
        try {
          const result = await executeAction(request.action, request.payload);
          process.stdout.write(
            `${encodeResponse(okResponse(request.id, result))}\n`,
          );
          log(
            'debug',
            `${request.action}#${request.id} ok in ${Date.now() - started}ms`,
          );
        } catch (error) {
          const code = errorCodeOf(error);
          const message =
            error instanceof Error ? error.message : String(error);
          process.stdout.write(
            `${encodeResponse(errorResponse(request.id, code, message))}\n`,
          );
          log(
            code === 'worker_internal' ? 'error' : 'debug',
            `${request.action}#${request.id} failed [${code}] in ${Date.now() - started}ms: ${message}`,
          );
        }
      });
    }
  });

  // stdin EOF (parent gone or done): flush and exit.
  const closed = new Promise<void>((resolve) => {
    process.stdin.on('end', () => resolve());
    process.stdin.on('close', () => resolve());
  });
  await closed;
  await pending;
  log('info', 'worker exiting (stdin closed)');
}

main().catch((error: unknown) => {
  log(
    'error',
    `fatal: ${error instanceof Error ? error.stack : String(error)}`,
  );
  process.exitCode = 1;
});
