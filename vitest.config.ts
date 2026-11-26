import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

const hooks = fileURLToPath(new URL('./packages/hooks/', import.meta.url));
const PERF_TESTS = 'test/**/*.perf.test.ts';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'hooks',
          root: hooks,
          include: ['test/**/*.test.ts'],
          exclude: [...configDefaults.exclude, PERF_TESTS],
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
