import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RunArgs } from '../src/args.ts';
import { ConfigError } from '../src/errors.ts';
import { IMAGES, imageRefs } from '../src/images.ts';
import { PLAN_FILE, planRun } from '../src/plan.ts';

const TASKS = fileURLToPath(new URL('../tasks/', import.meta.url));
const NOW = new Date('2026-11-27T10:15:30.123Z');
const ARGS: RunArgs = {
  task: '_template',
  condition: 'with',
  runs: 1,
  dryRun: true,
  publish: false,
};

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

describe('planRun', () => {
  let runsDir: string;
  beforeEach(() => {
    runsDir = join(mkdtempSync(join(tmpdir(), 'theoldman-runs-')), 'runs');
  });
  afterEach(() => {
    rmSync(join(runsDir, '..'), { recursive: true, force: true });
  });

  const plan = (args: Partial<RunArgs>, env: Record<string, string>, now = NOW) =>
    planRun({ ...ARGS, ...args }, env, { tasksDir: TASKS, runsDir }, now);

  it('writes the planned run to runs/<timestamp>/plan.json', () => {
    const { dir } = plan({}, { ANTHROPIC_API_KEY: 'sk-ant-x', ANTHROPIC_MODEL: 'sonnet' });
    expect(dir).toBe(join(runsDir, '2026-11-27T10-15-30-123Z'));
    expect(JSON.parse(readFileSync(join(dir, PLAN_FILE), 'utf8'))).toEqual({
      createdAt: '2026-11-27T10:15:30.123Z',
      task: {
        id: '_template',
        title: 'Template: add a clamp function',
        timeoutMinutes: 15,
        services: [],
      },
      condition: 'with',
      runs: 1,
      dryRun: true,
      publish: false,
      provider: { name: 'anthropic', env: ['ANTHROPIC_API_KEY'] },
      models: { ANTHROPIC_MODEL: 'sonnet', ANTHROPIC_DEFAULT_SONNET_MODEL: null },
      images: { node: imageRefs(IMAGES.node) },
    });
  });

  it('never writes a credential value to the run folder', () => {
    const secrets = {
      ANTHROPIC_API_KEY: 'sk-ant-api03-SECRET-ANTHROPIC',
      AWS_ACCESS_KEY_ID: 'AKIASECRETACCESSKEYID',
      AWS_SECRET_ACCESS_KEY: 'SECRET-aws-secret-access-key',
      AWS_SESSION_TOKEN: 'SECRET-aws-session-token',
      AWS_BEARER_TOKEN_BEDROCK: 'SECRET-bedrock-bearer',
    };
    const models = {
      ANTHROPIC_MODEL: 'us.anthropic.claude-sonnet-4-6',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'us.anthropic.claude-sonnet-4-6',
    };
    const { AWS_BEARER_TOKEN_BEDROCK, ...keys } = secrets;
    const bedrock = { CLAUDE_CODE_USE_BEDROCK: '1', AWS_REGION: 'us-east-1', ...models };
    const at = (second: number): Date => new Date(NOW.getTime() + second * 1000);
    plan({}, { ANTHROPIC_API_KEY: secrets.ANTHROPIC_API_KEY }, at(1));
    plan({ publish: true }, { ...bedrock, ...keys, ANTHROPIC_API_KEY: '' }, at(2));
    plan({ condition: 'without' }, { ...bedrock, AWS_BEARER_TOKEN_BEDROCK }, at(3));

    const files = filesUnder(runsDir);
    expect(files).toHaveLength(3);
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const value of Object.values(secrets)) expect(text).not.toContain(value);
    }
  });

  it('records the variable names Bedrock needs, not their values', () => {
    const { plan: written } = plan(
      {},
      { CLAUDE_CODE_USE_BEDROCK: '1', AWS_REGION: 'us-east-1', AWS_BEARER_TOKEN_BEDROCK: 'b' },
    );
    expect(written.provider).toEqual({
      name: 'bedrock',
      env: ['CLAUDE_CODE_USE_BEDROCK', 'AWS_REGION', 'AWS_BEARER_TOKEN_BEDROCK'],
    });
  });

  it('requires exact model IDs for a run marked for publication', () => {
    const env = { ANTHROPIC_API_KEY: 'sk-ant-x', ANTHROPIC_MODEL: 'sonnet' };
    expect(() => plan({ publish: true }, env)).toThrow(/exact model IDs, not aliases/);
    const exact = {
      ...env,
      ANTHROPIC_MODEL: 'claude-sonnet-5-5',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-5-5',
    };
    expect(plan({ publish: true }, exact).plan.publish).toBe(true);
  });

  it('allows aliases for runs that are not published', () => {
    expect(
      plan({}, { ANTHROPIC_API_KEY: 'sk-ant-x', ANTHROPIC_MODEL: 'haiku' }).plan.models,
    ).toEqual({ ANTHROPIC_MODEL: 'haiku', ANTHROPIC_DEFAULT_SONNET_MODEL: null });
  });

  it('writes nothing when validation fails', () => {
    expect(() => plan({}, {})).toThrow(ConfigError);
    expect(() => plan({ task: 'nope' }, { ANTHROPIC_API_KEY: 'sk-ant-x' })).toThrow(ConfigError);
    expect(existsSync(runsDir)).toBe(false);
  });

  it('refuses a real run until running in Docker exists', () => {
    expect(() => plan({ dryRun: false }, { ANTHROPIC_API_KEY: 'sk-ant-x' })).toThrow(
      /Only --dry-run is available so far/,
    );
    expect(existsSync(runsDir)).toBe(false);
  });
});
