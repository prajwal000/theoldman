import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

const hooks = fileURLToPath(new URL('./packages/hooks/', import.meta.url));
const evals = fileURLToPath(new URL('./evals/', import.meta.url));
const PERF_TESTS = 'test/**/*.perf.test.ts';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'hooks',
          root: hooks,
          include: ['test/**/*.test.ts'],
          // Fixtures are inputs for the rule harness; one named *.test.ts is not a test file.
          exclude: [...configDefaults.exclude, PERF_TESTS, 'test/fixtures/**'],
        },
      },
      {
        test: {
          name: 'evals',
          root: evals,
          include: ['test/**/*.test.ts'],
        },
      },
      {
        // Speed checks run last and on their own, so a busy machine running the other test files
        // in parallel cannot push a fast rule over its time limit.
        test: {
          name: 'perf',
          root: hooks,
          include: [PERF_TESTS],
          sequence: { groupOrder: 1 },
          fileParallelism: false,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['packages/hooks/src/lib/**/*.ts'],
      thresholds: { lines: 100 },
    },
  },
});
