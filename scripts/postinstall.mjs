#!/usr/bin/env node
// Post-install self-check for native modules (koffi, sharp).
//
// The package intentionally does not set the "os" field: that would make
// npm fail outright on non-Windows platforms. Instead this script reports
// clearly what is wrong and how to fix it, without failing the install.

import { createRequire } from 'node:module';
import process from 'node:process';

const require = createRequire(import.meta.url);

const isWindows = process.platform === 'win32';

function warn(title, lines) {
  console.warn(`\n[computer-use] ${title}`);
  for (const line of lines) {
    console.warn(`[computer-use]   ${line}`);
  }
}

if (!isWindows) {
  warn('This package only supports Windows (Windows 10 1607+).', [
    'The MCP server will not work on this platform.',
    'Native modules (koffi, sharp) may still install, but the Win32 layer',
    'is unavailable. Uninstall with: npm uninstall @lotteai/computer-use',
  ]);
  process.exit(0);
}

const problems = [];

try {
  require('koffi');
} catch (error) {
  problems.push({
    module: 'koffi',
    detail: String(error && error.message ? error.message : error),
  });
}

try {
  require('sharp');
} catch (error) {
  problems.push({
    module: 'sharp',
    detail: String(error && error.message ? error.message : error),
  });
}

if (problems.length === 0) {
  process.exit(0);
}

const lines = [];
for (const problem of problems) {
  lines.push(`${problem.module} failed to load: ${problem.detail}`);
}
lines.push(
  '',
  'The package is installed but cannot run until this is fixed. Try, in order:',
  '  1. Reinstall:            npm rebuild @lotteai/computer-use',
  '  2. Rebuild sharp:        npm rebuild sharp',
  '  3. Reinstall the package: npm install --force @lotteai/computer-use',
  '',
  'If the problem persists, security software may be blocking the native',
  'binaries. Allow the npm cache and node_modules directories, then retry.',
);
warn('Native module self-check failed', lines);

// Never fail the install: the user may be installing on a machine where the
// failure is recoverable, and a failed install gives no actionable output.
process.exit(0);
