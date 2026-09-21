import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/contract/**/*.test.ts'],
    exclude: ['tests/desktop/**', 'node_modules/**', 'dist/**'],
    environment: 'node',
    testTimeout: 15000,
  },
});
