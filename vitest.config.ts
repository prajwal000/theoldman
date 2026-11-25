import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/*'],
    coverage: {
      provider: 'v8',
      include: ['packages/hooks/src/lib/**/*.ts'],
      thresholds: { lines: 100 },
    },
  },
});
