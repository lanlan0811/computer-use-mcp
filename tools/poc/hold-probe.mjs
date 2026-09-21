import { spawn } from 'node:child_process';
import * as koffi from 'koffi';

// Probe: does the lease detect physical input fired DURING a long worker
// sleep, and does the detection depend on how long the pump is idle?
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
const user32 = koffi.load('user32.dll');
const keybd_event = user32.func('__stdcall', 'keybd_event', 'void', [
  'uint8',
  'uint8',
  'uint32',
  'uint64',
]);

for (const [duration, at] of [
  [200, 50],
  [600, 100],
  [1500, 100],
  [1500, 1300],
]) {
  const started = Date.now();
  const hold = call('hold_key', { keyNames: ['ctrl'], durationMs: duration });
  setTimeout(() => {
    keybd_event(0x10, 0, 0, 0n);
    keybd_event(0x10, 0, 0x0002, 0n);
    console.log(
      `  (physical events actually fired at +${Date.now() - started}ms, action ends at +${duration}ms)`,
    );
  }, at);
  const response = await hold;
  const verdict = response.ok ? 'NOT DETECTED' : response.error.code;
  console.log(`hold ${duration}ms, physical@${at}ms -> ${verdict}`);
  await new Promise((r) => setTimeout(r, 400));
}
worker.stdin.end();
setTimeout(() => worker.kill(), 300);
