/**
 * Dispatcher gate-branch tests with a stub worker.
 *
 * Phase 4 acceptance: with the worker replaced by a stub, every gate branch
 * and error-code path must be exercised — kill switch, lock competition,
 * foreground refusal, blocklist ordering, argument validation, held-mouse
 * ledger, batch invariants, and worker crashes.
 *
 * The config module is frozen at load, so each block resets every
 * COMPUTER_USE_* variable and re-imports through vi.resetModules() for a
 * fresh frozen config.
 */

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { WorkerClient } from '../../src/mcp/workerClient.js';

interface WorkerCall {
  action: string;
  payload: Record<string, unknown>;
}

/** Stub worker: canned responses, recorded calls, predicate-based failures. */
class StubWorker {
  readonly calls: WorkerCall[] = [];
  frontmost: unknown = {
    bundleId: 'notepad',
    displayName: 'notepad.exe',
  };
  screenshot: unknown = {
    // Comfortably above the 1024-byte retry threshold.
    base64: Buffer.alloc(2048, 0x41).toString('base64'),
    width: 1280,
    height: 720,
    displayWidth: 1920,
    displayHeight: 1080,
    displayId: 0,
    originX: 0,
    originY: 0,
  };
  /** (action, payload) → fail the call. */
  failing = new Map<string, (payload: Record<string, unknown>) => boolean>();

  async request(action: string, payload: Record<string, unknown> = {}) {
    this.calls.push({ action, payload });
    const predicate = this.failing.get(action);
    if (predicate?.(payload)) {
      const { CuToolError } = await import('../../src/core/errors.js');
      throw new CuToolError(
        'worker_crashed_result_unknown',
        `stub failure for ${action}`,
      );
    }
    switch (action) {
      case 'ping':
        return { pong: true };
      case 'frontmost_app':
        return this.frontmost;
      case 'get_display_size':
        return {
          displayId: 0,
          width: 1920,
          height: 1080,
          scaleFactor: 1,
          originX: 0,
          originY: 0,
          label: '\\.\\DISPLAY1',
        };
      case 'list_displays':
        return [
          {
            displayId: 0,
            width: 1920,
            height: 1080,
            scaleFactor: 1,
            originX: 0,
            originY: 0,
            label: '\\.\\DISPLAY1',
          },
        ];
      case 'screenshot':
        return this.screenshot;
      case 'cursor_position':
        return { x: 100, y: 200 };
      case 'list_installed_apps':
        return [
          { bundleId: 'notepad', displayName: 'Notepad' },
          { bundleId: 'calc', displayName: 'Calculator' },
        ];
      case 'read_clipboard':
        return 'previous-clipboard';
      case 'list_windows':
        return [];
      case 'zoom':
        return {
          base64: Buffer.alloc(2048, 0x42).toString('base64'),
          width: 100,
          height: 60,
        };
      default:
        return true;
    }
  }

  calledWith(action: string): WorkerCall[] {
    return this.calls.filter((call) => call.action === action);
  }
}

/** Reset every COMPUTER_USE_* variable, apply overrides, load fresh modules. */
async function loadDispatcher(
  env: Record<string, string | undefined>,
  worker: StubWorker,
  lockDir: string,
) {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('COMPUTER_USE_')) delete process.env[key];
  }
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) process.env[key] = value;
  }
  vi.resetModules();
  const { ToolDispatcher } = await import('../../src/mcp/dispatcher.js');
  const { FileLock: FreshFileLock } = await import('../../src/mcp/fileLock.js');
  const lock = new FreshFileLock(lockDir);
  const dispatcher = new ToolDispatcher(
    worker as unknown as WorkerClient,
    lock,
  );
  return { dispatcher, lock };
}

function tempDir(name: string): string {
  const dir = join(
    tmpdir(),
    `cu-test-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

function textOf(result: {
  content: Array<{ type: string; text?: string }>;
}): string {
  const first = result.content[0];
  return first && first.type === 'text' ? (first.text ?? '') : '';
}

describe('dispatcher gates (default config)', () => {
  it('unknown tool is bad_args without touching the worker', async () => {
    const worker = new StubWorker();
    const { dispatcher } = await loadDispatcher({}, worker, tempDir('d1'));
    const result = await dispatcher.handleToolCall('nope', {});
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('bad_args:');
    expect(worker.calls).toHaveLength(0);
  });

  it('wait never touches the lock or the worker', async () => {
    const worker = new StubWorker();
    const { dispatcher } = await loadDispatcher({}, worker, tempDir('d2'));
    const result = await dispatcher.handleToolCall('wait', { duration: 0.05 });
    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toBe('Waited 0.05s.');
    expect(worker.calls).toHaveLength(0);
  });

  it('screenshot stashes the baseline and returns the image', async () => {
    const worker = new StubWorker();
    const { dispatcher } = await loadDispatcher({}, worker, tempDir('d3'));
    const result = await dispatcher.handleToolCall('screenshot', {});
    expect(result.isError).toBeUndefined();
    expect(result.content.some((block) => block.type === 'image')).toBe(true);
    expect(worker.calledWith('screenshot')).toHaveLength(1);
    expect(worker.calledWith('list_displays')).toHaveLength(1);
    // Baseline stashed: a following click scales through it.
    await dispatcher.handleToolCall('click', { coordinate: [640, 360] });
    // 640 * (1920/1280) = 960; 360 * (1080/720) = 540
    expect(worker.calledWith('click')[0]!.payload).toMatchObject({
      x: 960,
      y: 540,
      button: 'left',
      count: 1,
    });
  });

  it('cold-start click falls back to /scaleFactor', async () => {
    const worker = new StubWorker();
    const { dispatcher } = await loadDispatcher({}, worker, tempDir('d4'));
    await dispatcher.handleToolCall('click', { coordinate: [960, 540] });
    expect(worker.calledWith('click')[0]!.payload).toMatchObject({
      x: 960,
      y: 540,
    });
  });

  it('frontmost_app null refuses input before any injection', async () => {
    const worker = new StubWorker();
    worker.frontmost = null;
    const { dispatcher } = await loadDispatcher({}, worker, tempDir('d5'));
    const result = await dispatcher.handleToolCall('type_text', { text: 'hi' });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('state_conflict:');
    expect(worker.calledWith('type')).toHaveLength(0);
  });

  it('argument validation fails before the worker is touched', async () => {
    const worker = new StubWorker();
    const { dispatcher } = await loadDispatcher({}, worker, tempDir('d6'));
    const result = await dispatcher.handleToolCall('click', {
      coordinate: [1],
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('bad_args:');
    expect(worker.calledWith('click')).toHaveLength(0);
    expect(worker.calledWith('frontmost_app')).toHaveLength(0);
  });

  it('zoom requires a prior screenshot', async () => {
    const worker = new StubWorker();
    const { dispatcher } = await loadDispatcher({}, worker, tempDir('d7'));
    const result = await dispatcher.handleToolCall('zoom', {
      region: [0, 0, 10, 10],
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('state_conflict:');
  });

  it('zoom does not update the coordinate baseline', async () => {
    const worker = new StubWorker();
    const { dispatcher } = await loadDispatcher({}, worker, tempDir('d8'));
    await dispatcher.handleToolCall('screenshot', {});
    await dispatcher.handleToolCall('zoom', { region: [0, 0, 100, 100] });
    await dispatcher.handleToolCall('click', { coordinate: [640, 360] });
    expect(worker.calledWith('click')[0]!.payload).toMatchObject({
      x: 960,
      y: 540,
    });
  });

  it('scroll maps direction and amount to deltas', async () => {
    const worker = new StubWorker();
    const { dispatcher } = await loadDispatcher({}, worker, tempDir('d9'));
    await dispatcher.handleToolCall('screenshot', {});
    await dispatcher.handleToolCall('scroll', {
      coordinate: [10, 10],
      scroll_direction: 'up',
      scroll_amount: 3,
    });
    expect(worker.calledWith('scroll')[0]!.payload).toMatchObject({
      deltaX: 0,
      deltaY: -3,
    });
    await dispatcher.handleToolCall('scroll', {
      coordinate: [10, 10],
      scroll_direction: 'right',
      scroll_amount: 2,
    });
    expect(worker.calledWith('scroll')[1]!.payload).toMatchObject({
      deltaX: 2,
      deltaY: 0,
    });
  });

  it('multi-line type goes through the clipboard with restore', async () => {
    const worker = new StubWorker();
    const { dispatcher } = await loadDispatcher({}, worker, tempDir('d10'));
    const result = await dispatcher.handleToolCall('type_text', {
      text: 'line1\nline2',
    });
    expect(textOf(result)).toBe('Typed (via clipboard).');
    expect(worker.calledWith('write_clipboard')[0]!.payload).toMatchObject({
      text: 'line1\nline2',
    });
    expect(worker.calledWith('paste_clipboard')).toHaveLength(1);
    // Restore is queued as a follow-up write; flush microtasks.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(worker.calledWith('write_clipboard')[1]?.payload).toMatchObject({
      text: 'previous-clipboard',
    });
    expect(worker.calledWith('type')).toHaveLength(0);
  });

  it('single-line type goes through the per-character worker call', async () => {
    const worker = new StubWorker();
    const { dispatcher } = await loadDispatcher({}, worker, tempDir('d11'));
    const result = await dispatcher.handleToolCall('type_text', {
      text: 'abc',
    });
    expect(textOf(result)).toBe('Typed 3 grapheme(s).');
    expect(worker.calledWith('type')[0]!.payload).toMatchObject({
      text: 'abc',
    });
    expect(worker.calledWith('paste_clipboard')).toHaveLength(0);
  });

  it('mouse_down twice is a state conflict; mouse_up releases', async () => {
    const worker = new StubWorker();
    const { dispatcher } = await loadDispatcher({}, worker, tempDir('d12'));
    await dispatcher.handleToolCall('mouse_down', {});
    const second = await dispatcher.handleToolCall('mouse_down', {});
    expect(second.isError).toBe(true);
    expect(textOf(second)).toContain('state_conflict:');
    expect(worker.calledWith('mouse_down')).toHaveLength(1);
    await dispatcher.handleToolCall('mouse_up', {});
    expect(worker.calledWith('mouse_up')).toHaveLength(1);
    await dispatcher.handleToolCall('mouse_down', {});
    expect(worker.calledWith('mouse_down')).toHaveLength(2);
  });

  it('worker failure surfaces as worker_crashed_result_unknown', async () => {
    const worker = new StubWorker();
    worker.failing.set('mouse_down', () => true);
    const { dispatcher } = await loadDispatcher({}, worker, tempDir('d13'));
    const result = await dispatcher.handleToolCall('mouse_down', {});
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('worker_crashed_result_unknown:');
  });

  it('batch stops on first error and reports progress', async () => {
    const worker = new StubWorker();
    worker.failing.set('key', (payload) => payload.keySequence === 'b');
    const { dispatcher } = await loadDispatcher({}, worker, tempDir('d14'));
    const result = await dispatcher.handleToolCall('batch', {
      actions: [
        { action: 'press_key', text: 'a' },
        { action: 'press_key', text: 'b' },
        { action: 'wait', duration: 0.01 },
      ],
    });
    const payload = JSON.parse(textOf(result)) as {
      completed: Array<{ action: string; ok: boolean }>;
      failed: { action: string; ok: boolean; output: string };
      remaining: number;
    };
    expect(payload.completed).toHaveLength(1);
    expect(payload.completed[0]!.action).toBe('press_key');
    expect(payload.failed.ok).toBe(false);
    expect(payload.remaining).toBe(1);
    expect(worker.calledWith('key')).toHaveLength(2);
  });

  it('mid-batch screenshots never move the coordinate baseline', async () => {
    const worker = new StubWorker();
    const { dispatcher } = await loadDispatcher({}, worker, tempDir('d15'));
    await dispatcher.handleToolCall('screenshot', {});
    const result = await dispatcher.handleToolCall('batch', {
      actions: [
        { action: 'screenshot' },
        { action: 'click', coordinate: [640, 360] },
      ],
    });
    expect(result.isError).toBeUndefined();
    // Click still scales through the PRE-BATCH baseline (960, 540).
    expect(worker.calledWith('click')[0]!.payload).toMatchObject({
      x: 960,
      y: 540,
    });
  });

  it('cancellation before dispatch reports result-unknown', async () => {
    const worker = new StubWorker();
    const { dispatcher } = await loadDispatcher({}, worker, tempDir('d16'));
    const controller = new AbortController();
    controller.abort();
    const result = await dispatcher.handleToolCall(
      'type_text',
      { text: 'x' },
      { signal: controller.signal },
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('user_interference_result_unknown:');
    expect(worker.calledWith('type')).toHaveLength(0);
  });

  it('save_to_disk writes a file and reports the path', async () => {
    const worker = new StubWorker();
    const dir = tempDir('saved');
    const { dispatcher } = await loadDispatcher(
      { COMPUTER_USE_SHOT_DIR: dir },
      worker,
      tempDir('d17'),
    );
    const result = await dispatcher.handleToolCall('screenshot', {
      save_to_disk: true,
    });
    const saved = result.content.find(
      (block) =>
        block.type === 'text' && (block.text ?? '').startsWith('Saved to '),
    );
    expect(saved).toBeDefined();
    const path = (saved as { text: string }).text.replace('Saved to ', '');
    expect(readFileSync(path).length).toBe(2048);
  });
});

describe('dispatcher gates (custom config)', () => {
  it('kill switch refuses every tool', async () => {
    const worker = new StubWorker();
    const { dispatcher } = await loadDispatcher(
      { COMPUTER_USE_DISABLED: '1' },
      worker,
      tempDir('c1'),
    );
    for (const [tool, args] of [
      ['screenshot', {}],
      ['click', { coordinate: [1, 1] }],
      ['wait', { duration: 0.01 }],
      ['batch', { actions: [] }],
    ] as const) {
      const result = await dispatcher.handleToolCall(tool, args);
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('Computer control is disabled');
    }
    expect(worker.calls).toHaveLength(0);
  });

  it('blocklist hits before the frontmost gate', async () => {
    const worker = new StubWorker();
    worker.frontmost = null; // would be state_conflict if the gate ran first
    const { dispatcher } = await loadDispatcher(
      { COMPUTER_USE_ALLOW_SYSTEM_KEYS: '0' },
      worker,
      tempDir('c2'),
    );
    const result = await dispatcher.handleToolCall('press_key', {
      text: 'alt+tab',
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('grant_flag_required:');
    const shifted = await dispatcher.handleToolCall('press_key', {
      text: 'shift+alt+tab',
    });
    expect(textOf(shifted)).toContain('grant_flag_required:');
    expect(worker.calledWith('key')).toHaveLength(0);
  });

  it('system keys allowed when the grant flag is on', async () => {
    const worker = new StubWorker();
    const { dispatcher } = await loadDispatcher(
      { COMPUTER_USE_ALLOW_SYSTEM_KEYS: '1' },
      worker,
      tempDir('c3'),
    );
    const result = await dispatcher.handleToolCall('press_key', {
      text: 'alt+tab',
    });
    expect(result.isError).toBeUndefined();
    expect(worker.calledWith('key')).toHaveLength(1);
  });

  it('click modifier blacklist is gated too', async () => {
    const worker = new StubWorker();
    const { dispatcher } = await loadDispatcher(
      { COMPUTER_USE_ALLOW_SYSTEM_KEYS: '0' },
      worker,
      tempDir('c4'),
    );
    const result = await dispatcher.handleToolCall('click', {
      coordinate: [10, 10],
      text: 'alt+f4',
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('grant_flag_required:');
    expect(worker.calledWith('click')).toHaveLength(0);
  });

  it('clipboard grants off refuse read and write', async () => {
    const worker = new StubWorker();
    const { dispatcher } = await loadDispatcher(
      {
        COMPUTER_USE_ALLOW_CLIPBOARD_READ: '0',
        COMPUTER_USE_ALLOW_CLIPBOARD_WRITE: '0',
      },
      worker,
      tempDir('c5'),
    );
    const read = await dispatcher.handleToolCall('read_clipboard', {});
    expect(textOf(read)).toContain('grant_flag_required:');
    const write = await dispatcher.handleToolCall('write_clipboard', {
      text: 'x',
    });
    expect(textOf(write)).toContain('grant_flag_required:');
    expect(worker.calledWith('read_clipboard')).toHaveLength(0);
    expect(worker.calledWith('write_clipboard')).toHaveLength(0);
  });

  it('open_app resolves against the inventory only', async () => {
    const worker = new StubWorker();
    const { dispatcher } = await loadDispatcher({}, worker, tempDir('c6'));
    const found = await dispatcher.handleToolCall('open_app', {
      app: 'Notepad',
    });
    expect(found.isError).toBeUndefined();
    expect(worker.calledWith('open_app')[0]!.payload).toMatchObject({
      bundleId: 'notepad',
    });
    const missing = await dispatcher.handleToolCall('open_app', {
      app: 'powershell',
    });
    expect(missing.isError).toBe(true);
    expect(textOf(missing)).toContain(
      'not found in the installed application inventory',
    );
  });
});

describe('cross-process file lock', () => {
  let helper: ReturnType<typeof spawn>;
  const lockDir = tempDir('lock');

  beforeAll(() => {
    // A live process holding the lock.
    helper = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], {
      stdio: 'ignore',
    });
  });

  afterAll(() => {
    helper.kill();
  });

  it('a live holder yields cu_lock_held', async () => {
    writeFileSync(
      join(lockDir, 'computer-use.lock'),
      `${helper.pid}\n`,
      'utf8',
    );
    const worker = new StubWorker();
    const { dispatcher } = await loadDispatcher({}, worker, lockDir);
    const result = await dispatcher.handleToolCall('screenshot', {});
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('cu_lock_held:');
    expect(worker.calledWith('screenshot')).toHaveLength(0);
  });

  it('a stale lock from a dead pid is stolen', async () => {
    // Pid 2^22 is overwhelmingly likely to be dead on any OS.
    writeFileSync(join(lockDir, 'computer-use.lock'), '4194304\n', 'utf8');
    const worker = new StubWorker();
    const { dispatcher } = await loadDispatcher({}, worker, lockDir);
    const result = await dispatcher.handleToolCall('screenshot', {});
    expect(result.isError).toBeUndefined();
    expect(worker.calledWith('screenshot')).toHaveLength(1);
  });
});
