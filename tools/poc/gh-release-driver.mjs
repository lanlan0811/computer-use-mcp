// Drives the built MCP server to publish the v0.1.0 GitHub Release through
// the user's browser — an end-to-end field test of the product itself.
//
// One command per invocation (the MCP server is spawned fresh each time):
//   node tools/poc/gh-release-driver.mjs init
//   node tools/poc/gh-release-driver.mjs shot <name>      # saves gh-<name>.jpg
//   node tools/poc/gh-release-driver.mjs frontmost
//   node tools/poc/gh-release-driver.mjs click <x> <y>
//   node tools/poc/gh-release-driver.mjs type <text>
//   node tools/poc/gh-release-driver.mjs typefile <path>
//   node tools/poc/gh-release-driver.mjs key <chord>
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const serverEntry = join(here, '..', '..', 'dist', 'index.js');

const server = spawn(process.execPath, [serverEntry], {
  stdio: ['pipe', 'pipe', 'pipe'],
});
let serverStderr = '';
server.stderr.setEncoding('utf8');
server.stderr.on('data', (chunk) => {
  serverStderr += chunk;
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
      90000,
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

const [command, ...args] = process.argv.slice(2);

/** Run several actions in one server session: seq "click 1 2" "key enter" ...
 *  Stops at the first failed action (fail-closed, like the dispatcher). */
async function runSequence(steps) {
  for (const step of steps) {
    const [action, ...rest] = step.trim().split(/\s+/);
    if (action === 'click') {
      const result = await callTool('click', {
        coordinate: [Number(rest[0]), Number(rest[1])],
      });
      if (result.result?.isError) {
        throw new Error(
          `click ${rest[0]},${rest[1]} failed: ${textOf(result.result)}`,
        );
      }
      console.log(`click ${rest[0]},${rest[1]}: ${textOf(result.result)}`);
    } else if (action === 'triple') {
      const result = await callTool('triple_click', {
        coordinate: [Number(rest[0]), Number(rest[1])],
      });
      if (result.result?.isError) {
        throw new Error(
          `triple ${rest[0]},${rest[1]} failed: ${textOf(result.result)}`,
        );
      }
      console.log(`triple ${rest[0]},${rest[1]}: ${textOf(result.result)}`);
    } else if (action === 'type') {
      const result = await callTool('type_text', { text: rest.join(' ') });
      if (result.result?.isError) {
        throw new Error(`type failed: ${textOf(result.result)}`);
      }
      console.log(`type: ${textOf(result.result)}`);
    } else if (action === 'key') {
      const keyArgs = { text: rest[0] };
      if (rest[1] !== undefined) keyArgs.repeat = Number(rest[1]);
      const result = await callTool('press_key', keyArgs);
      if (result.result?.isError) {
        throw new Error(`key ${rest[0]} failed: ${textOf(result.result)}`);
      }
      console.log(
        `key ${rest[0]}${rest[1] ? ` x${rest[1]}` : ''}: ${textOf(result.result)}`,
      );
    } else if (action === 'wait') {
      await new Promise((r) => setTimeout(r, Number(rest[0])));
      console.log(`wait ${rest[0]}ms`);
    } else {
      throw new Error(`unknown step: ${step}`);
    }
  }
}

async function handshake() {
  const init = await rpc('initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'gh-release-driver', version: '0.1.0' },
  });
  if (!init.result)
    throw new Error(`initialize failed: ${JSON.stringify(init)}`);
  server.stdin.write(
    `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })}\n`,
  );
  return init;
}

function callTool(name, args_) {
  return rpc('tools/call', { name, arguments: args_ });
}

function textOf(result) {
  const first = result?.content?.[0];
  return first && first.type === 'text' ? first.text : '';
}

async function finish() {
  server.stdin.end();
  await new Promise((r) => setTimeout(r, 300));
  server.kill();
  const useful = serverStderr
    .split('\n')
    .filter((line) => !line.includes('[worker debug]'))
    .join('\n')
    .trim();
  if (useful !== '') console.log(`--- server stderr ---\n${useful}`);
}

try {
  await handshake();

  if (command === 'seq') {
    await runSequence(args);
  } else if (command === 'init') {
    const list = await rpc('tools/list');
    const names = (list.result?.tools ?? []).map((t) => t.name);
    console.log(`tools: ${names.length} (expect 22)`);
    console.log(names.join(', '));
  } else if (command === 'frontmost') {
    const result = await callTool('frontmost_app', {}).catch(async () => {
      // frontmost_app is a worker action, not a tool; drive it via the worker
      // indirectly through a screenshot first, then use the dispatcher path:
      return null;
    });
    if (result) {
      console.log(textOf(result));
    } else {
      console.log('frontmost_app is not a tool; use shot + cursor_position');
    }
  } else if (command === 'shot') {
    const name = args[0] ?? 'step';
    const result = await callTool('screenshot', {});
    if (result.result?.isError) {
      console.log('SCREENSHOT ERROR:', textOf(result.result));
    } else {
      const image = result.result.content.find((b) => b.type === 'image');
      const path = join(here, '..', 'smoke', `gh-${name}.jpg`);
      writeFileSync(path, Buffer.from(image.data, 'base64'));
      console.log(`saved ${path} (${image.data.length} b64 chars)`);
    }
  } else if (command === 'cursor') {
    const result = await callTool('cursor_position', {});
    console.log(textOf(result.result));
  } else if (command === 'click') {
    const [x, y] = args.map(Number);
    const result = await callTool('click', { coordinate: [x, y] });
    console.log(
      result.result?.isError
        ? `CLICK ERROR: ${textOf(result.result)}`
        : textOf(result.result),
    );
  } else if (command === 'type') {
    const text = args.join(' ');
    const result = await callTool('type_text', { text });
    console.log(
      result.result?.isError
        ? `TYPE ERROR: ${textOf(result.result)}`
        : textOf(result.result),
    );
  } else if (command === 'typefile') {
    const text = (await import('node:fs')).readFileSync(args[0], 'utf8');
    const result = await callTool('type_text', { text });
    console.log(
      result.result?.isError
        ? `TYPE ERROR: ${textOf(result.result)}`
        : textOf(result.result),
    );
  } else if (command === 'key') {
    const result = await callTool('press_key', { text: args[0] });
    console.log(
      result.result?.isError
        ? `KEY ERROR: ${textOf(result.result)}`
        : textOf(result.result),
    );
  } else {
    console.log('unknown command:', command);
  }
} catch (error) {
  console.log('DRIVER ERROR:', error.message);
  process.exitCode = 1;
} finally {
  await finish();
}
