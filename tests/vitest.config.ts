import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['ai-tools/**/*.test.ts'],
    exclude: ['ai-tools/suites/evals.test.ts'],
    testTimeout: 45000,
    hookTimeout: 30000,
    setupFiles: ['./setup.ts'],
    sequence: { concurrent: false },
  },
});
