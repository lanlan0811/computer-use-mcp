/**
 * Cross-process file lock: at most one session uses the computer at a time
 * (plan §7.1 gate 3).
 *
 * O_EXCL create-or-fail is the whole mechanism. The lock records the owning
 * pid so a stale lock (crashed holder) can be detected and stolen: reading
 * the pid and probing liveness is enough, because a live holder renews
 * nothing — a stolen lock is only possible when the holder is gone.
 *
 * The lock is session-scoped: acquired on the first action tool and held for
 * the server process lifetime, mirroring cc-haha's cuLock semantics
 * (windowsLegacyToolCalls.ts:3025-3076).
 */

import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

import { CuToolError } from '../core/errors.js';

const LOCK_FILE_NAME = 'computer-use.lock';

function processAlive(pid: number): boolean {
  try {
    // Signal 0 probes existence without delivering anything.
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but is owned by someone else.
    const code = (error as NodeJS.ErrnoException).code;
    return code === 'EPERM';
  }
}

export class FileLock {
  private readonly directory: string;
  private readonly path: string;
  private held = false;

  constructor(directory: string) {
    this.directory = directory;
    this.path = join(directory, LOCK_FILE_NAME);
  }

  get isHeld(): boolean {
    return this.held;
  }

  /**
   * Acquire the lock, stealing it from a dead holder. Throws
   * `cu_lock_held` when another live session owns it.
   */
  acquire(): void {
    if (this.held) return;
    mkdirSync(this.directory, { recursive: true });
    try {
      this.createLockFile();
      this.held = true;
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') {
        throw new CuToolError(
          'state_conflict',
          `Could not create the computer-use lock file (${this.path}): ${String(error)}`,
        );
      }
    }
    // The lock exists: either a live holder, or a dead one to steal from.
    const ownerPid = this.readOwnerPid();
    if (
      ownerPid !== null &&
      ownerPid !== process.pid &&
      processAlive(ownerPid)
    ) {
      throw new CuToolError(
        'cu_lock_held',
        'Another session is currently using the computer. Wait for the user ' +
          'to acknowledge it is finished, or find a non-computer-use approach ' +
          'if one is readily apparent.',
      );
    }
    // Stale (or ours from a previous life): take it over.
    try {
      unlinkSync(this.path);
    } catch {
      // Racing steal by another process: re-check once below.
    }
    try {
      this.createLockFile();
      this.held = true;
    } catch {
      throw new CuToolError(
        'cu_lock_held',
        'Another session just acquired the computer-use lock. Try again.',
      );
    }
  }

  private createLockFile(): void {
    const fd = openSync(this.path, 'wx', 0o644);
    try {
      writeSync(fd, `${process.pid}\n`);
    } finally {
      closeSync(fd);
    }
  }

  private readOwnerPid(): number | null {
    try {
      const content = readFileSync(this.path, 'utf8').trim();
      const pid = Number.parseInt(content, 10);
      return Number.isFinite(pid) ? pid : null;
    } catch {
      return null;
    }
  }

  /** Release the lock. Safe to call when not held. */
  release(): void {
    if (!this.held) return;
    this.held = false;
    try {
      if (this.readOwnerPid() === process.pid) {
        unlinkSync(this.path);
      }
    } catch {
      // Already gone: nothing to release.
    }
  }
}
