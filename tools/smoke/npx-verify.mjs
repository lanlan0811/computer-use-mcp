// Verifies the PUBLISHED package over npx: real download from npm, real MCP
// handshake, real tool list, real screenshot. Run: node tools/smoke/npx-verify.mjs
//
// Must run OUTSIDE the project directory: npx inside this repo resolves the
// package name against the local package.json (same name) and fails to find a
// local bin.
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';

const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';

// .cmd cannot be spawned without a shell on modern Node (CVE-2024-27980).
const server = spawn(npxCommand, ['--yes', '@lotteai/computer-use@0.1.0'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  shell: true,
  cwd: tmpdir(),
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
      60000,
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

let failures = 0;
function check(name, ok, detail) {
  if (!ok) failures += 1;
  console.log(
    `[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` -- ${detail}` : ''}`,
  );
}

try {
  const init = await rpc('initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'npx-verify', version: '0.1.0' },
  });
  check(
    'npx @lotteai/computer-use@0.1.0 starts and handshakes',
    init.result?.serverInfo?.name === 'computer-use' &&
      typeof init.result?.instructions === 'string',
    init.result?.serverInfo?.name,
  );
  server.stdin.write(
    `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })}\n`,
  );
  const list = await rpc('tools/list');
  check(
    'published package advertises 22 tools',
    (list.result?.tools ?? []).length === 22,
    `${(list.result?.tools ?? []).length} tools`,
  );

  // End-to-end: a real screenshot through the published package (spawns its
  // own worker and drives the real desktop).
  const shot = await rpc('tools/call', {
    name: 'screenshot',
    arguments: {},
  });
  const image = (shot.result?.content ?? []).find(
    (block) => block.type === 'image',
  );
  check(
    'screenshot over npx returns a real image',
    shot.result?.isError !== true &&
      image?.type === 'image' &&
      image.data.length > 5000,
    image ? `jpeg ${image.data.length} b64 chars` : JSON.stringify(shot.result),
  );
} catch (error) {
  failures += 1;
  console.log(`[FAIL] npx verify threw: ${error.message}`);
  if (stderr.trim() !== '')
    console.log(stderr.trim().split('\n').slice(-5).join('\n'));
} finally {
  server.stdin.end();
  await new Promise((r) => setTimeout(r, 500));
  server.kill();
}

console.log('');
if (failures > 0) {
  console.log(`NPX VERIFY: FAIL (${failures})`);
  process.exit(1);
} else {
  console.log('NPX VERIFY: PASS');
  process.exit(0);
}
