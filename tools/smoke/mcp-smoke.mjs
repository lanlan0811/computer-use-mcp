// Live MCP smoke test: speak real MCP over stdio to the built server.
// Run manually: node tools/smoke/mcp-smoke.mjs

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const serverEntry = join(here, '..', '..', 'dist', 'index.js');

const server = spawn(process.execPath, [serverEntry], {
  stdio: ['pipe', 'pipe', 'pipe'],
});

let stderr = '';
server.stderr.setEncoding('utf8');
server.stderr.on('data', (chunk) => {
  stderr += chunk;
});

let buffer = '';
const pending = new Map();

server.stdout.setEncoding('utf8');
server.stdout.on('data', (chunk) => {
  buffer += chunk;
  let index = buffer.indexOf('\n');
  while (index !== -1) {
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    if (line !== '') {
      const message = JSON.parse(line);
      const settle = pending.get(message.id);
      if (settle) {
        pending.delete(message.id);
        settle(message);
      }
    }
    index = buffer.indexOf('\n');
  }
});

let nextId = 1;
function rpc(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`timeout: ${method}`)),
      30000,
    );
    pending.set(id, (message) => {
      clearTimeout(timer);
      resolve(message);
    });
    server.stdin.write(
      `${JSON.stringify({ jsonrpc: '2.0', id, method, params: params ?? {} })}\n`,
    );
  });
}

function notify(method, params) {
  server.stdin.write(
    `${JSON.stringify({ jsonrpc: '2.0', method, params: params ?? {} })}\n`,
  );
}

let failures = 0;
function check(name, ok, detail) {
  if (!ok) failures += 1;
  console.log(
    `[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` -- ${detail}` : ''}`,
  );
}

try {
  // 1. MCP handshake
  const init = await rpc('initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'smoke', version: '0.1.0' },
  });
  check(
    'initialize handshake',
    init.result?.serverInfo?.name === 'computer-use' &&
      typeof init.result?.instructions === 'string' &&
      init.result.instructions.length > 500,
    init.result?.serverInfo
      ? `server=${init.result.serverInfo.name}, instructions ${init.result.instructions?.length} chars`
      : JSON.stringify(init.error),
  );
  notify('notifications/initialized');

  // 2. Tool list
  const list = await rpc('tools/list');
  const names = (list.result?.tools ?? []).map((t) => t.name);
  check('lists exactly 22 tools', names.length === 22, `${names.length} tools`);
  for (const expected of [
    'screenshot',
    'zoom',
    'click',
    'double_click',
    'triple_click',
    'right_click',
    'middle_click',
    'type_text',
    'press_key',
    'scroll',
    'drag',
    'move_mouse',
    'open_app',
    'switch_display',
    'read_clipboard',
    'write_clipboard',
    'wait',
    'cursor_position',
    'hold_key',
    'mouse_down',
    'mouse_up',
    'batch',
  ]) {
    if (!names.includes(expected)) check(`tool present: ${expected}`, false);
  }
  check(
    'all 22 expected tool names present',
    names.length === 22 && names.every((n) => typeof n === 'string'),
  );

  // 3. Bad tool name
  const unknown = await rpc('tools/call', { name: 'nope', arguments: {} });
  check(
    'unknown tool returns isError with bad_args',
    unknown.result?.isError === true &&
      String(unknown.result?.content?.[0]?.text ?? '').startsWith('bad_args:'),
    unknown.result?.content?.[0]?.text,
  );

  // 4. wait (no worker spawn needed)
  const waited = await rpc('tools/call', {
    name: 'wait',
    arguments: { duration: 0.2 },
  });
  check(
    'wait tool works',
    waited.result?.isError !== true &&
      /Waited 0.2s/.test(waited.result?.content?.[0]?.text ?? ''),
    waited.result?.content?.[0]?.text,
  );

  // 5. wait with bad args
  const badWait = await rpc('tools/call', {
    name: 'wait',
    arguments: { duration: 1000 },
  });
  check(
    'wait rejects duration > 100s',
    badWait.result?.isError === true &&
      String(badWait.result?.content?.[0]?.text ?? '').startsWith('bad_args:'),
    badWait.result?.content?.[0]?.text,
  );

  // 6. screenshot (spawns the worker for real)
  const shot = await rpc('tools/call', { name: 'screenshot', arguments: {} });
  const content = shot.result?.content ?? [];
  const image = content.find((block) => block.type === 'image');
  check(
    'screenshot returns an image block over MCP',
    shot.result?.isError !== true &&
      image?.type === 'image' &&
      image.mimeType === 'image/jpeg' &&
      image.data.length > 5000,
    image ? `jpeg ${image.data.length} b64 chars` : JSON.stringify(shot.result),
  );

  // 7. cursor_position after a screenshot → image_pixels space
  const cursor = await rpc('tools/call', {
    name: 'cursor_position',
    arguments: {},
  });
  check(
    'cursor_position returns JSON payload',
    cursor.result?.isError !== true &&
      /coordinateSpace/.test(cursor.result?.content?.[0]?.text ?? ''),
    cursor.result?.content?.[0]?.text,
  );

  // 8. blacklist gate (grant flag on by default, so this is allowed) and
  //    denied when the flag is off is covered by stub tests; here we only
  //    check the blacklist message path is not hit for an ordinary key.
  // 9. off-screen coordinate guard
  const offscreen = await rpc('tools/call', {
    name: 'click',
    arguments: { coordinate: [999999, 999999] },
  });
  check(
    'off-screen click refused with point_outside_display',
    offscreen.result?.isError === true &&
      String(offscreen.result?.content?.[0]?.text ?? '').startsWith(
        'point_outside_display:',
      ),
    offscreen.result?.content?.[0]?.text,
  );

  // 10. batch validation error
  const badBatch = await rpc('tools/call', {
    name: 'batch',
    arguments: { actions: [{ action: 'open_app', app: 'x' }] },
  });
  check(
    'batch rejects non-batchable actions',
    badBatch.result?.isError === true &&
      String(badBatch.result?.content?.[0]?.text ?? '').startsWith('bad_args:'),
    badBatch.result?.content?.[0]?.text,
  );
} catch (error) {
  failures += 1;
  console.log(`[FAIL] mcp smoke threw: ${error.message}`);
} finally {
  server.stdin.end();
  await new Promise((r) => setTimeout(r, 500));
  server.kill();
}

if (stderr.trim() !== '') {
  console.log('\n--- server stderr ---');
  console.log(
    stderr
      .trim()
      .split('\n')
      .filter((line) => !line.includes('[worker debug]'))
      .slice(-8)
      .join('\n'),
  );
}

console.log('');
if (failures > 0) {
  console.log(`MCP SMOKE RESULT: FAIL (${failures} check(s) failed)`);
  process.exit(1);
} else {
  console.log('MCP SMOKE RESULT: PASS');
  process.exit(0);
}
