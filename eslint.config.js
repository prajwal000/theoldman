import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores([
    'coverage/',
    'site/dist/',
    'evals/runs/',
    'plugin/scripts/',
    // Rule fixtures are deliberately bad code, checked by the rule harness, not by lint.
    'packages/hooks/test/fixtures/',
    // Sample apps for smoke tests: their dependencies are never installed here, so typed lint
    // rules cannot resolve them. Prettier still checks their formatting.
    'examples/',
  ]),
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['vitest.config.ts'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      'no-console': 'error',
    },
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
