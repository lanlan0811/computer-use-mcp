import { defineConfig } from 'vitest/config';

// Desktop tests only: opt-in via COMPUTER_USE_DESKTOP_TESTS=1, never part of
// the default suite or CI (plan §12).
export default defineConfig({
  test: {
    include: ['tests/desktop/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
