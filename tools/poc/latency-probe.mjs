import { spawn } from 'node:child_process';
import * as koffi from 'koffi';

// Probe: measure the delivery latency of an untagged keybd_event to the
// monitor's hook, polling snapshot() in a tight loop.
const worker = spawn(process.execPath, ['dist/worker/entry.js'], {
  stdio: ['pipe', 'pipe', 'pipe'],
});
worker.stderr.setEncoding('utf8');
worker.stderr.on('data', (chunk) => {
  for (const line of chunk.split('\n')) {
    if (line.trim() !== '') console.log(`  [w] ${line}`);
  }
});
let buffer = '';
const pending = new Map();
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
let nextId = 1;
function call(action, payload) {
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    worker.stdin.write(
      JSON.stringify({ v: 1, id, action, payload: payload ?? {} }) + '\n',
    );
  });
}

// A hold action whose sleep is long enough for us to fire input at a known
// offset, then watch the worker's own monitor log lines with timestamps.
const hold = call('hold_key', { keyNames: ['ctrl'], durationMs: 3000 });
const fired = Date.now();
setTimeout(() => {
  const user32 = koffi.load('user32.dll');
  const keybd_event = user32.func('__stdcall', 'keybd_event', 'void', [
    'uint8',
    'uint8',
    'uint32',
    'uint64',
  ]);
  keybd_event(0x10, 0, 0, 0n);
  keybd_event(0x10, 0, 0x0002, 0n);
  console.log(`fired 2 physical events at +${Date.now() - fired}ms`);
}, 500);
const response = await hold;
console.log(
  `action ended at +${Date.now() - fired}ms ->`,
  response.ok ? 'NOT DETECTED' : response.error.code,
);
worker.stdin.end();
setTimeout(() => worker.kill(), 300);
