import { spawn } from 'node:child_process';
import * as koffi from 'koffi';

// Probe: repeat the short-gap case N times to see whether the miss is
// systematic or a race.
const worker = spawn(process.execPath, ['dist/worker/entry.js'], {
  stdio: ['pipe', 'pipe', 'pipe'],
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

let detected = 0;
const rounds = 12;
for (let i = 0; i < rounds; i += 1) {
  const hold = call('hold_key', { keyNames: ['ctrl'], durationMs: 300 });
  setTimeout(() => {
    keybd_event(0x10, 0, 0, 0n);
    keybd_event(0x10, 0, 0x0002, 0n);
  }, 100);
  const response = await hold;
  if (!response.ok) detected += 1;
  await new Promise((r) => setTimeout(r, 250));
}
console.log(`short-gap detection: ${detected}/${rounds}`);
worker.stdin.end();
setTimeout(() => worker.kill(), 300);
