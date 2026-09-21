/**
 * Worker client: owns the resident worker subprocess.
 *
 * Lifecycle (plan §5.3):
 *   - lazy: spawned on the first FFI-using tool call, so sessions that never
 *     touch the computer cost no process and no hooks;
 *   - resident: reused across calls;
 *   - idle: shuts down after workerIdleMs without requests, releasing the
 *     low-level hooks;
 *   - crash: an unexpected exit restarts the worker and reports
 *     `worker_crashed_result_unknown` for the in-flight action — never a
 *     silent retry. More than 3 crashes in 60s stops restarting.
 *
 * Every request carries a hard timeout; a timeout on a mutating action is
 * reported as result-unknown (plan §7.4), because the worker may still be
 * injecting input into the shared stream.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import process from 'node:process';

import { CuToolError, type CuErrorCode } from '../core/errors.js';
import { config } from '../core/config.js';
import {
  LineFramer,
  PROTOCOL_VERSION,
  WORKER_TO_CORE_ERROR_CODE,
  type WorkerErrorCode,
  type WorkerResponse,
} from '../worker/protocol.js';
import { createLogger } from './logging.js';

const logger = createLogger('worker');

/** Actions that inject input; a timeout on these is never safe to retry. */
const MUTATING_ACTIONS: ReadonlySet<string> = new Set([
  'click',
  'drag',
  'move_mouse',
  'scroll',
  'mouse_down',
  'mouse_up',
  'key',
  'hold_key',
  'type',
  'paste_clipboard',
]);

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: unknown): void;
  timer: NodeJS.Timeout;
  action: string;
}

const CRASH_WINDOW_MS = 60000;
const CRASH_LIMIT = 3;

/** Children whose exit was requested by shutdown() — not a crash. */
const intentionalExits = new WeakSet<ChildProcessWithoutNullStreams>();

export class WorkerUnavailable extends CuToolError {
  constructor(message: string) {
    super('worker_crashed_result_unknown', message);
    this.name = 'WorkerUnavailable';
  }
}

/**
 * Resolve the worker entry. In the built package the server is
 * dist/index.js and the worker is dist/worker/entry.js; a source checkout
 * keeps the same shape under src/. Pick the first candidate that exists.
 */
function resolveWorkerEntry(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, 'worker', 'entry.js'),
    join(here, '..', 'worker', 'entry.js'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return candidates[0]!;
}

export class WorkerClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private framer = new LineFramer();
  private pending = new Map<number, PendingRequest>();
  private nextId = 1;
  private idleTimer: NodeJS.Timeout | null = null;
  private starting: Promise<void> | null = null;
  private crashes: number[] = [];
  private stopped = false;

  constructor(private readonly entryPath: string = resolveWorkerEntry()) {}

  /** Ensure the worker is running (lazy spawn). */
  private async ensureStarted(): Promise<void> {
    if (this.child && !this.child.killed) return;
    if (this.starting) return this.starting;
    this.starting = this.spawn();
    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
  }

  private async spawn(): Promise<void> {
    if (this.stopped) {
      throw new WorkerUnavailable(
        'The computer-use worker was shut down after repeated crashes.',
      );
    }
    const child = spawn(process.execPath, [this.entryPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;
    this.framer = new LineFramer();
    // An exit is "expected" only when shutdown() marked this exact child;
    // anything else is a crash, even if a respawn already replaced us.

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      for (const line of this.framer.push(chunk)) {
        this.handleLine(line);
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      for (const line of chunk.split('\n')) {
        if (line.trim() !== '') logger.debug(line.trimEnd());
      }
    });
    child.on('error', (error: Error) => {
      logger.error(`worker process error: ${error.message}`);
    });
    child.on('exit', (code: number | null, signal: string | null) => {
      if (this.child === child) this.child = null;
      this.clearIdleTimer();
      if (intentionalExits.has(child)) return;
      this.registerCrash();
      const detail = signal ? `signal ${signal}` : `code ${code}`;
      logger.error(`worker exited unexpectedly (${detail})`);
      for (const [id, request] of [...this.pending.entries()]) {
        this.pending.delete(id);
        clearTimeout(request.timer);
        request.reject(
          new WorkerUnavailable(
            `The computer-use worker exited unexpectedly (${detail}). The ` +
              'action may already have been sent — take a screenshot before ' +
              'continuing.',
          ),
        );
      }
    });

    // Protocol handshake: a bad version refuses startup with a clear error.
    // The handshake gets a generous floor: spawning the process and loading
    // the ESM worker can take seconds on a cold or loaded machine, and that
    // startup cost is not an "action timeout".
    const handshakeTimeoutMs = Math.max(config.actionTimeoutMs, 10000);
    await this.request('ping', {}, handshakeTimeoutMs);
    logger.info(`worker up (protocol v${PROTOCOL_VERSION})`);
  }

  private registerCrash(): void {
    const now = Date.now();
    this.crashes = [
      ...this.crashes.filter((at) => now - at < CRASH_WINDOW_MS),
      now,
    ];
    if (this.crashes.length > CRASH_LIMIT) {
      this.stopped = true;
      logger.error(
        `worker crashed ${this.crashes.length} times in ${CRASH_WINDOW_MS}ms; ` +
          'not restarting anymore',
      );
    }
  }

  private handleLine(line: string): void {
    let response: WorkerResponse;
    try {
      response = JSON.parse(line) as WorkerResponse;
    } catch {
      logger.warn(`worker sent an unparseable line: ${line.slice(0, 200)}`);
      return;
    }
    const request = this.pending.get(response.id);
    if (!request) return;
    this.pending.delete(response.id);
    clearTimeout(request.timer);
    this.armIdleTimer();
    if (response.ok) {
      request.resolve(response.result);
      return;
    }
    const coreCode =
      WORKER_TO_CORE_ERROR_CODE[response.error.code as WorkerErrorCode] ??
      response.error.code;
    request.reject(
      new CuToolError(coreCode as CuErrorCode, response.error.message),
    );
  }

  /** Send one action and await its result. Hard timeout included. */
  async request(
    action: string,
    payload: Record<string, unknown> = {},
    timeoutMsOverride?: number,
  ): Promise<unknown> {
    await this.ensureStarted();
    const child = this.child;
    if (!child) {
      throw new WorkerUnavailable('The computer-use worker is not running.');
    }
    const id = this.nextId++;
    const timeoutMs = timeoutMsOverride ?? config.actionTimeoutMs;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        const unknown = MUTATING_ACTIONS.has(action);
        reject(
          new CuToolError(
            'worker_crashed_result_unknown',
            `The ${action} action timed out after ${timeoutMs}ms. ` +
              (unknown
                ? 'The action may still be running and input may land later — take a screenshot before continuing.'
                : 'Try again.'),
          ),
        );
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, action });
      this.armIdleTimer();
      child.stdin.write(
        `${JSON.stringify({ v: PROTOCOL_VERSION, id, action, payload })}\n`,
      );
    });
  }

  private armIdleTimer(): void {
    this.clearIdleTimer();
    if (config.workerIdleMs <= 0) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.pending.size === 0) this.shutdown();
    }, config.workerIdleMs);
    // Do not let the idle timer keep the process alive on its own.
    this.idleTimer.unref();
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  /** Stop the worker (parent shutdown or idle). */
  shutdown(): void {
    this.stopped = true;
    this.clearIdleTimer();
    const child = this.child;
    this.child = null;
    if (!child) return;
    intentionalExits.add(child);
    try {
      child.stdin.end();
    } catch {
      // already closed
    }
    const killer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // already gone
      }
    }, 1000);
    killer.unref();
  }

  /** Whether the worker process is currently alive. */
  get isRunning(): boolean {
    return this.child !== null && !this.child.killed;
  }

  /** Reset the shutdown flag (tests). */
  reset(): void {
    this.stopped = false;
    this.crashes = [];
  }
}
