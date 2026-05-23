import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['unit/**/*.test.ts'],
    testTimeout: 10_000,
    hookTimeout: 5_000,
  },
});
