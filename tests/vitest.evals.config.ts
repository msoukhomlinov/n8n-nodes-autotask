import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['ai-tools/suites/evals.test.ts'],
    testTimeout: 600_000,
    hookTimeout: 30_000,
    setupFiles: ['./setup.ts'],
    sequence: { concurrent: false },
  },
});
