/**
 * Worker client lifecycle tests: crash restart, the crash budget, and the
 * hard timeout. Uses a real subprocess so the exit/restart paths are real
 * (Phase 4 acceptance: 崩溃重启).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { WorkerClient as WorkerClientType } from '../../src/mcp/workerClient.js';
import type { WorkerClient as WorkerClientClass } from '../../src/mcp/workerClient.js';

/** A scripted fake worker: pings, crashes on demand, or hangs. */
const FAKE_WORKER = `
import process from 'node:process';
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let index = buffer.indexOf('\\n');
  while (index !== -1) {
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    if (line !== '') {
      const request = JSON.parse(line);
      if (request.action === 'crash') {
        setTimeout(() => process.exit(1), 5);
        // Never respond: the crash must reject the in-flight request.
      } else if (request.action === 'hang') {
        // Never respond: exercises the hard timeout.
      } else {
        process.stdout.write(JSON.stringify({ v: 1, id: request.id, ok: true, result: { echo: request.action } }) + '\\n');
      }
    }
    index = buffer.indexOf('\\n');
  }
});
`;

let workerDir: string;
let workerPath: string;
let WorkerClient: typeof WorkerClientType;

beforeAll(async () => {
  // The config module freezes at load, so set the timeout BEFORE importing
  // the client module.
  process.env.COMPUTER_USE_ACTION_TIMEOUT_MS = '300';
  vi.resetModules();
  workerDir = join(tmpdir(), `cu-worker-test-${Date.now()}`);
  mkdirSync(workerDir, { recursive: true });
  workerPath = join(workerDir, 'fake-worker.mjs');
  writeFileSync(workerPath, FAKE_WORKER, 'utf8');
  ({ WorkerClient } = await import('../../src/mcp/workerClient.js'));
});

afterAll(() => {
  delete process.env.COMPUTER_USE_ACTION_TIMEOUT_MS;
});

function makeClient(): WorkerClientClass {
  return new WorkerClient(workerPath);
}

describe('WorkerClient lifecycle', () => {
  it('spawns lazily and speaks the protocol', async () => {
    const client = makeClient();
    const result = await client.request('ping');
    expect(result).toEqual({ echo: 'ping' });
    expect(client.isRunning).toBe(true);
    client.shutdown();
  });

  it('an unexpected exit rejects the in-flight request and restarts', async () => {
    const client = makeClient();
    await client.request('ping');
    const crashed = await client
      .request('crash')
      .catch((error: Error & { code?: string }) => error);
    expect(crashed).toBeInstanceOf(Error);
    expect((crashed as Error & { code?: string }).code).toBe(
      'worker_crashed_result_unknown',
    );
    // A later request respawns the worker transparently.
    const after = await client.request('ping');
    expect(after).toEqual({ echo: 'ping' });
    client.shutdown();
  });

  it('a hanging action times out as result-unknown', async () => {
    const client = makeClient();
    const timedOut = await client
      .request('hang')
      .catch((error: Error & { code?: string }) => error);
    expect((timedOut as Error & { code?: string }).code).toBe(
      'worker_crashed_result_unknown',
    );
    expect((timedOut as Error).message).toContain('timed out');
    // The worker is still usable afterwards.
    const after = await client.request('ping');
    expect(after).toEqual({ echo: 'ping' });
    client.shutdown();
  });

  it('repeated crashes stop the restart loop', async () => {
    const client = makeClient();
    // Crash until the client gives up (budget is 3 per 60s; allow slack for
    // scheduling jitter before asserting the give-up behavior).
    let stopError: (Error & { code?: string }) | null = null;
    for (let attempt = 0; attempt < 8 && !stopError; attempt += 1) {
      const error = await client
        .request('crash')
        .catch((err: Error & { code?: string }) => err);
      if (
        error instanceof Error &&
        error.message.includes('shut down after repeated crashes')
      ) {
        stopError = error;
      }
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    expect(stopError).not.toBeNull();
    expect(stopError!.code).toBe('worker_crashed_result_unknown');
    client.shutdown();
  });
});
