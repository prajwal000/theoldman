import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The real entry point, run the way `pnpm --filter evals run eval` runs it, but only on paths
// that write nothing, so the test never touches evals/runs/.
const RUN = fileURLToPath(new URL('../src/run.ts', import.meta.url));
const RUNS_DIR = fileURLToPath(new URL('../runs/', import.meta.url));
const NODE_FLAGS = ['--experimental-strip-types', '--disable-warning=ExperimentalWarning'];

// Only what Node needs to start: no provider variables from the machine running the tests.
const BASE_ENV: Record<string, string> = {};
for (const name of ['PATH', 'Path', 'SystemRoot', 'TEMP', 'TMP']) {
  const value = process.env[name];
  if (value !== undefined) BASE_ENV[name] = value;
}

function run(args: string[], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [...NODE_FLAGS, RUN, ...args], {
    env: { ...BASE_ENV, ...env },
    encoding: 'utf8',
  });
}

const runFolders = (): string[] => (existsSync(RUNS_DIR) ? readdirSync(RUNS_DIR) : []);

describe('eval command', () => {
  it('prints usage for --help', () => {
    const result = run(['--help']);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^Usage: pnpm --filter evals run eval --task <id>/);
  });

  it('fails with one clear line when no provider is set, and writes nothing', () => {
    const before = runFolders();
    const result = run(['--task', '_template', '--condition', 'with', '--runs', '1', '--dry-run']);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/^eval: No model provider is configured\./);
    expect(result.stderr).not.toMatch(/\n\s+at /);
    expect(runFolders()).toEqual(before);
  });

  it('fails on a mixed provider environment without echoing the key', () => {
    const key = 'sk-ant-api03-NOT-FOR-OUTPUT';
    const result = run(['--task', '_template', '--condition', 'without', '--dry-run'], {
      ANTHROPIC_API_KEY: key,
      CLAUDE_CODE_USE_BEDROCK: '1',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/^eval: Mixed provider environment/);
    expect(result.stdout + result.stderr).not.toContain(key);
  });

  it('fails on a bad argument with the usage', () => {
    const result = run(['--task', '_template', '--condition', 'maybe']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--condition must be "with" or "without"');
    expect(result.stderr).toContain('Usage:');
  });
});
