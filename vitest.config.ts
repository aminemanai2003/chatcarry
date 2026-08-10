import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    maxWorkers: 1,
    testTimeout: 5_000,
    hookTimeout: 5_000
  }
});
