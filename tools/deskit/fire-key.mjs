// Fires untagged legacy key events after a delay, then exits.
// Usage: node tools/deskit/fire-key.mjs <delayMs> [vk]
// A separate process keeps the timing independent of the test runner's
// event loop (vitest sleep jitter once made a physical input land after the
// action had already ended).
import * as koffi from 'koffi';

const delayMs = Number.parseInt(process.argv[2] ?? '300', 10);
const vk = Number.parseInt(process.argv[3] ?? '0x10', 16);

const started = Date.now();
setTimeout(() => {
  const user32 = koffi.load('user32.dll');
  const keybd_event = user32.func('__stdcall', 'keybd_event', 'void', [
    'uint8',
    'uint8',
    'uint32',
    'uint64',
  ]);
  keybd_event(vk, 0, 0, 0n);
  keybd_event(vk, 0, 0x0002, 0n);
  process.stdout.write(`fired at +${Date.now() - started}ms\n`);
}, delayMs);
