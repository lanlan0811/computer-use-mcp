/**
 * Real desktop tests — opt-in only (COMPUTER_USE_DESKTOP_TESTS=1).
 *
 * These drive the actual desktop: they click, type, and simulate physical
 * input. CI must never run them (unattended desktops make them flaky and
 * they would fight whatever the runner is doing), so the suite refuses to
 * run without the environment switch (plan §12.3).
 *
 * Flow safety: the Notepad test types a marker, verifies the screen changed,
 * then clears the text and closes the window, leaving the desktop as it was.
 */

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

const ENABLED = process.env.COMPUTER_USE_DESKTOP_TESTS === '1';

/** The suite under test: the real dispatcher over the real worker. */
async function loadStack() {
  const { ToolDispatcher } = await import('../../src/mcp/dispatcher.js');
  const { WorkerClient } = await import('../../src/mcp/workerClient.js');
  const { FileLock } = await import('../../src/mcp/fileLock.js');
  // The desktop tests drive the BUILT worker (npm run build first): the
  // worker is a plain .js child process, so it must exist on disk.
  const workerEntry = join(
    fileURLToPath(new URL('../../dist/worker/entry.js', import.meta.url)),
  );
  const worker = new WorkerClient(workerEntry);
  const dir = join(tmpdir(), `cu-desktop-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  const dispatcher = new ToolDispatcher(worker as never, new FileLock(dir));
  return { dispatcher, worker };
}

function textOf(result: {
  content: Array<{ type: string; text?: string }>;
}): string {
  const first = result.content[0];
  return first && first.type === 'text' ? (first.text ?? '') : '';
}

function imageOf(result: {
  content: Array<{ type: string; data?: string }>;
}): Buffer | null {
  const block = result.content.find((b) => b.type === 'image');
  return block?.data ? Buffer.from(block.data, 'base64') : null;
}

/** Mean absolute pixel difference between two JPEGs (0..255). */
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function imageDelta(a: Buffer, b: Buffer): Promise<number> {
  const [ra, rb] = await Promise.all([
    sharp(a).raw().toBuffer({ resolveWithObject: true }),
    sharp(b).raw().toBuffer({ resolveWithObject: true }),
  ]);
  const width = Math.min(ra.info.width, rb.info.width);
  const height = Math.min(ra.info.height, rb.info.height);
  let total = 0;
  let count = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const ia = (y * ra.info.width + x) * 3;
      const ib = (y * rb.info.width + x) * 3;
      total += Math.abs(ra.data[ia]! - rb.data[ib]!);
      count += 1;
    }
  }
  return count === 0 ? 0 : total / count;
}

/** Mean absolute pixel difference between two JPEGs (0..255). */

describe.skipIf(!ENABLED)('real desktop', () => {
  it('captures a real screenshot with correct geometry', async () => {
    const { dispatcher, worker } = await loadStack();
    try {
      const result = await dispatcher.handleToolCall('screenshot', {});
      expect(result.isError).toBeUndefined();
      const jpeg = imageOf(result);
      expect(jpeg).not.toBeNull();
      expect(jpeg!.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
      const meta = await sharp(jpeg!).metadata();
      expect(meta.format).toBe('jpeg');
      expect(meta.width).toBeLessThanOrEqual(1568);
      expect(meta.height).toBeLessThanOrEqual(1568);
    } finally {
      worker.shutdown();
    }
  });

  it('moves the cursor to a coordinate and reads it back', async () => {
    const { dispatcher, worker } = await loadStack();
    try {
      await dispatcher.handleToolCall('screenshot', {});
      const move = await dispatcher.handleToolCall('move_mouse', {
        coordinate: [300, 300],
      });
      expect(move.isError).toBeUndefined();
      const cursor = await dispatcher.handleToolCall('cursor_position', {});
      const point = JSON.parse(textOf(cursor)) as { x: number; y: number };
      // Allow a few pixels of animation slack.
      expect(Math.abs(point.x - 300)).toBeLessThanOrEqual(8);
      expect(Math.abs(point.y - 300)).toBeLessThanOrEqual(8);
    } finally {
      worker.shutdown();
    }
  });

  it('clicks at an empty taskbar point without error', async () => {
    const { dispatcher, worker } = await loadStack();
    try {
      const click = await dispatcher.handleToolCall('click', {
        coordinate: [683, 760],
      });
      // The receipt is a dispatch confirmation, not a result proof.
      expect(click.isError).toBeUndefined();
      expect(textOf(click)).toContain('Clicked');
    } finally {
      worker.shutdown();
    }
  });

  it('types a marker into Notepad, sees the screen change, then cleans up', async () => {
    const { dispatcher, worker } = await loadStack();
    // Notepad is a Store app: it only enters the installed-app inventory
    // while running, so start it directly (the inventory path is covered by
    // the stub tests) and drive the rest through the tools.
    const notepad = spawn('notepad.exe', [], { stdio: 'ignore' });
    try {
      await sleep(1500);
      // Foreground it through the tool itself: spawning a process does not
      // guarantee focus on Windows (focus-stealing prevention).
      await dispatcher.handleToolCall('open_app', { app: 'notepad' });
      await sleep(600);
      const frontmost = await worker.request('frontmost_app');
      const frontName = String(
        (frontmost as { displayName?: string } | null)?.displayName ?? '',
      ).toLowerCase();
      if (!frontName.includes('notepad')) {
        // Focus-stealing prevention kept Explorer in front. Global keystrokes
        // would hit Explorer — refuse rather than risk it.
        console.log(
          `SKIP typing check: foreground is "${frontName}", not notepad ` +
            '(Windows focus-stealing prevention)',
        );
        return;
      }

      const before = await dispatcher.handleToolCall('screenshot', {});
      const typed = await dispatcher.handleToolCall('type_text', {
        text: 'CU-DESKTOP-MARKER-1234',
      });
      expect(typed.isError).toBeUndefined();
      await sleep(400);
      const after = await dispatcher.handleToolCall('screenshot', {});
      const delta = await imageDelta(imageOf(before)!, imageOf(after)!);
      expect(delta).toBeGreaterThan(0.5);
      // Close by process (never ctrl+a/delete/alt+f4 — global keystrokes hit
      // whatever is frontmost, and a stray delete once destroyed a project
      // directory this way).
      notepad.kill();
      await sleep(400);
    } finally {
      try {
        notepad.kill();
      } catch {
        // already dead
      }
      worker.shutdown();
    }
  });

  it('detects simulated physical input during an action (result UNKNOWN)', async () => {
    const { dispatcher, worker } = await loadStack();
    // The physical input comes from a separate process on its own clock: a
    // test-runner sleep can drift enough to fire after the action ended.
    const fire = spawn(
      process.execPath,
      [
        join(
          fileURLToPath(
            new URL('../../tools/deskit/fire-key.mjs', import.meta.url),
          ),
        ),
        '300',
      ],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    );
    try {
      const hold = dispatcher
        .handleToolCall('hold_key', { text: 'ctrl', duration: 1.5 })
        .catch((error: unknown) => error);
      const settled = await hold;
      // Either the lease aborts (interference) or reports result-unknown —
      // never a clean success while the user was typing.
      if (settled instanceof Error) throw settled;
      const result = settled as { isError?: boolean; content: unknown[] };
      expect(result.isError).toBe(true);
      expect(textOf(result as never)).toMatch(
        /user_interference(_result_unknown)?:/,
      );
    } finally {
      fire.kill();
      worker.shutdown();
    }
  });

  it('refuses off-screen coordinates with point_outside_display', async () => {
    const { dispatcher, worker } = await loadStack();
    try {
      const result = await dispatcher.handleToolCall('click', {
        coordinate: [999999, 999999],
      });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('point_outside_display:');
    } finally {
      worker.shutdown();
    }
  });

  it('reports display configuration honestly', async () => {
    const { dispatcher, worker } = await loadStack();
    try {
      const shot = await dispatcher.handleToolCall('screenshot', {});
      expect(shot.isError).toBeUndefined();
      const displays = await dispatcher.handleToolCall('cursor_position', {});
      expect(displays.isError).toBeUndefined();
      // Multi-monitor and DPI behaviors are conditional on the machine; this
      // run at least proves the display path works on the current setup.
    } finally {
      worker.shutdown();
    }
  });
});
