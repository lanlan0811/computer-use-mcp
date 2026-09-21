import { spawn } from 'node:child_process';
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
const apps = await call('list_installed_apps');
const names = (apps.result ?? []).map((a) => a.bundleId);
console.log(
  'notepad present:',
  names.filter((n) => n.toLowerCase().includes('notepad')),
);
console.log(
  'calc present:',
  names.filter((n) => n.toLowerCase().includes('calc')),
);
console.log('total apps:', names.length);
console.log('sample:', names.slice(0, 15).join(', '));
worker.stdin.end();
setTimeout(() => worker.kill(), 300);
