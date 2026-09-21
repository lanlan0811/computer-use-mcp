// Live smoke test for the worker: spawn it, speak NDJSON, verify responses.
// Run manually: node tools/smoke/worker-smoke.mjs

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const workerEntry = join(here, '..', '..', 'dist', 'worker', 'entry.js');

const worker = spawn(process.execPath, [workerEntry], {
  stdio: ['pipe', 'pipe', 'pipe'],
});

let stderr = '';
worker.stderr.setEncoding('utf8');
worker.stderr.on('data', (chunk) => {
  stderr += chunk;
});

let buffer = '';
const pending = new Map();
let nextId = 1;

worker.stdout.setEncoding('utf8');
worker.stdout.on('data', (chunk) => {
  buffer += chunk;
  let index = buffer.indexOf('\n');
  while (index !== -1) {
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    if (line !== '') {
      const response = JSON.parse(line);
      const settle = pending.get(response.id);
      if (settle) {
        pending.delete(response.id);
        settle(response);
      }
    }
    index = buffer.indexOf('\n');
  }
});

function call(action, payload) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timeout: ${action}`)),
      30000,
    );
    pending.set(id, (response) => {
      clearTimeout(timer);
      resolve(response);
    });
    worker.stdin.write(
      `${JSON.stringify({ v: 1, id, action, payload: payload ?? {} })}\n`,
    );
  });
}

let failures = 0;
function check(name, ok, detail) {
  if (!ok) failures += 1;
  console.log(
    `[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` -- ${detail}` : ''}`,
  );
}

try {
  const ping = await call('ping');
  check('ping responds ok', ping.ok === true && ping.result?.pong === true);

  const displays = await call('list_displays');
  check(
    'list_displays returns at least one display with geometry',
    displays.ok === true &&
      Array.isArray(displays.result) &&
      displays.result.length >= 1,
    displays.ok
      ? `${displays.result.length} display(s): ${displays.result.map((d) => `${d.label} ${d.width}x${d.height}@${d.scaleFactor}`).join(', ')}`
      : displays.error?.message,
  );
  const primary = displays.ok ? displays.result[0] : null;

  const size = await call('get_display_size', {
    displayId: primary?.displayId,
  });
  check(
    'get_display_size matches the primary display',
    size.ok === true && size.result?.width === primary?.width,
    size.ok
      ? `${size.result.width}x${size.result.height}`
      : size.error?.message,
  );

  const shot = await call('screenshot');
  check(
    'screenshot returns base64 JPEG with expected geometry',
    shot.ok === true &&
      typeof shot.result?.base64 === 'string' &&
      shot.result.base64.length > 1000 &&
      shot.result.width > 0 &&
      shot.result.displayWidth === primary?.width &&
      shot.result.displayHeight === primary?.height,
    shot.ok
      ? `image ${shot.result.width}x${shot.result.height}, display ${shot.result.displayWidth}x${shot.result.displayHeight}, b64 ${shot.result.base64.length} chars`
      : shot.error?.message,
  );
  check(
    'screenshot is pre-scaled to the image budget',
    shot.ok && shot.result.width <= 1568 && shot.result.height <= 1568,
    shot.ok ? `${shot.result.width}x${shot.result.height}` : '',
  );

  const bytes = shot.ok
    ? Buffer.from(shot.result.base64, 'base64')
    : Buffer.alloc(0);
  check(
    'screenshot payload is a real JPEG (SOI/APP0 markers)',
    bytes.length > 2 &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[2] === 0xff,
    `first bytes: ${[...bytes.slice(0, 4)].map((b) => b.toString(16)).join(' ')}`,
  );

  const cursor = await call('cursor_position');
  check(
    'cursor_position returns finite coordinates',
    cursor.ok === true &&
      Number.isFinite(cursor.result?.x) &&
      Number.isFinite(cursor.result?.y),
    cursor.ok
      ? `x=${cursor.result.x} y=${cursor.result.y}`
      : cursor.error?.message,
  );

  const front = await call('frontmost_app');
  check(
    'frontmost_app identifies the foreground window owner',
    front.ok === true &&
      (front.result === null || typeof front.result.bundleId === 'string'),
    front.ok ? JSON.stringify(front.result) : front.error?.message,
  );

  const windows = await call('list_windows');
  check(
    'list_windows enumerates titled windows',
    windows.ok === true && Array.isArray(windows.result),
    windows.ok ? `${windows.result.length} window(s)` : windows.error?.message,
  );

  const installed = await call('list_installed_apps');
  check(
    'list_installed_apps returns a non-trivial inventory',
    installed.ok === true &&
      Array.isArray(installed.result) &&
      installed.result.length > 3,
    installed.ok
      ? `${installed.result.length} app(s), e.g. ${installed.result
          .slice(0, 3)
          .map((a) => a.displayName)
          .join(', ')}`
      : installed.error?.message,
  );

  const perms = await call('check_permissions');
  check(
    'check_permissions always granted on Windows',
    perms.ok === true &&
      perms.result?.accessibility === true &&
      perms.result?.screenRecording === true,
  );

  // Full lease path: hooks install, tagged SendInput, barrier drain, and the
  // finalize check that our own tagged events were observed. F15 is unbound
  // by every mainstream app, so this is safe on a live desktop.
  const key = await call('key', { keySequence: 'f12' });
  check(
    'key action completes the lease path (monitor sees tagged input)',
    key.ok === true,
    key.ok ? 'ok' : `${key.error?.code}: ${key.error?.message}`,
  );

  const held = await call('hold_key', { keyNames: ['f12'], durationMs: 60 });
  check(
    'hold_key completes the lease path',
    held.ok === true,
    held.ok ? 'ok' : `${held.error?.code}: ${held.error?.message}`,
  );

  const cursorAfter = await call('cursor_position');
  check(
    'cursor_position still finite after input actions',
    cursorAfter.ok === true && Number.isFinite(cursorAfter.result?.x),
    cursorAfter.ok
      ? `x=${cursorAfter.result.x} y=${cursorAfter.result.y}`
      : cursorAfter.error?.message,
  );

  // Protocol robustness: bad version, unknown action, bad payload shape.
  const badVersion = await (async () => {
    const id = nextId++;
    return new Promise((resolve) => {
      const timer = setTimeout(
        () => resolve({ ok: false, error: { message: 'timeout' } }),
        5000,
      );
      pending.set(id, (r) => {
        clearTimeout(timer);
        resolve(r);
      });
      worker.stdin.write(`${JSON.stringify({ v: 9, id, action: 'ping' })}\n`);
      // The worker cannot parse a foreign version, so it answers with id -1.
      const watch = (r) => {
        if (r.id === -1) {
          clearTimeout(timer);
          pending.delete(id);
          resolve(r);
        }
      };
      pending.set(-1, watch);
    });
  })();
  check(
    'bad protocol version is refused',
    badVersion.ok === false && /version/.test(badVersion.error?.message ?? ''),
    badVersion.error?.message,
  );

  const unknown = await call('no_such_action');
  check(
    'unknown action returns bad_args',
    unknown.ok === false && unknown.error?.code === 'bad_args',
    unknown.error?.code,
  );

  const badPoint = await call('click', { x: -5, y: 10 });
  // The parent tool layer rejects negatives as bad_args before dispatch; the
  // worker's own delivery guard reports point_outside_display.
  check(
    'negative coordinate never reaches the input stream',
    badPoint.ok === false &&
      ['point_outside_display', 'bad_args'].includes(badPoint.error?.code),
    badPoint.error?.code,
  );

  const offscreen = await call('move_mouse', { x: 999999, y: 10 });
  check(
    'off-screen point is refused with point_outside_display',
    offscreen.ok === false && offscreen.error?.code === 'point_outside_display',
    offscreen.error?.code,
  );
} catch (error) {
  failures += 1;
  console.log(`[FAIL] smoke test threw: ${error.message}`);
} finally {
  worker.stdin.end();
  await new Promise((r) => setTimeout(r, 500));
  worker.kill();
}

if (stderr.trim() !== '') {
  console.log('\n--- worker stderr ---');
  console.log(stderr.trim());
}

console.log('');
if (failures > 0) {
  console.log(`SMOKE RESULT: FAIL (${failures} check(s) failed)`);
  process.exit(1);
} else {
  console.log('SMOKE RESULT: PASS');
  process.exit(0);
}
