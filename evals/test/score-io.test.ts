import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type DockerExec, InterruptedError } from '../src/docker.ts';
import { ConfigError } from '../src/errors.ts';
import { AGENT_IMAGE } from '../src/images.ts';
import { isExactModelId } from '../src/models.ts';
import {
  aggregate,
  modelLabel,
  type Results,
  validateResults,
  writeResults,
} from '../src/score/results.ts';
import { readRunFolder } from '../src/score/run-folder.ts';
import { inspectWorkspace, parseReport, workspaceArgs } from '../src/score/workspace.ts';
import { plan, writeRunFolder } from './run-folders.ts';

const INPUT = {
  starterDir: 'C:\\evals\\tasks\\_template\\starter',
  runDir: 'C:\\evals\\runs\\2026-11-27T10-00-00-000Z\\with-1',
  reportScript: 'C:\\evals\\docker\\score-report.mjs',
  name: 'theoldman-score-x-with-1',
};

describe('workspaceArgs', () => {
  it('mounts the starter, the run folder and the script read-only, and passes no environment', () => {
    const args = workspaceArgs(INPUT);
    expect(args).toEqual([
      'run',
      '--rm',
      '--name',
      'theoldman-score-x-with-1',
      '--mount',
      `type=bind,source=${INPUT.starterDir},target=/starter,readonly`,
      '--mount',
      `type=bind,source=${INPUT.runDir},target=/run,readonly`,
      '--mount',
      `type=bind,source=${INPUT.reportScript},target=/score/report.mjs,readonly`,
      '--entrypoint',
      'node',
      AGENT_IMAGE,
      '/score/report.mjs',
    ]);
    expect(args).not.toContain('-e');
    expect(args).not.toContain('--env');
  });

  it('refuses a path --mount would misread', () => {
    expect(() => workspaceArgs({ ...INPUT, runDir: 'C:\\runs,odd' })).toThrow(ConfigError);
  });
});

describe('parseReport', () => {
  const report = {
    notes: ['no eslint.config file: ESLint not run'],
    files: { 'src/math.ts': 'export {};\n' },
    tsc: { errors: 2 },
    eslint: null,
  };

  it('reads the last line of the container output', () => {
    expect(parseReport(`npm noise\n${JSON.stringify(report)}\n`)).toEqual({
      ...report,
      error: null,
    });
  });

  it('passes on a diff that does not apply', () => {
    expect(parseReport(JSON.stringify({ notes: [], error: 'does not apply' }))).toEqual({
      files: {},
      tsc: null,
      eslint: null,
      notes: [],
      error: 'does not apply',
    });
  });

  it.each([
    ['', 'printed no report'],
    ['[]', 'not an object'],
    [JSON.stringify({ ...report, files: { 'a.ts': 1 } }), 'is not text'],
    [JSON.stringify({ ...report, tsc: { errors: -1 } }), 'malformed tsc count'],
    [JSON.stringify({ ...report, eslint: { errors: 1 } }), 'malformed ESLint counts'],
  ])('rejects a report without its shape (%#)', (stdout, message) => {
    expect(() => parseReport(stdout)).toThrow(message);
  });
});

describe('inspectWorkspace', () => {
  const ok = { code: 0, stdout: '', stderr: '', timedOut: false };

  it('removes the container when scoring is interrupted', async () => {
    const controller = new AbortController();
    const calls: string[][] = [];
    const docker: DockerExec = (args) => {
      calls.push([...args]);
      if (args[0] === 'run') controller.abort();
      return Promise.resolve({ ...ok, code: null });
    };
    await expect(inspectWorkspace(docker, INPUT, {}, controller.signal)).rejects.toThrow(
      InterruptedError,
    );
    expect(calls.at(-1)).toEqual(['rm', '-f', INPUT.name]);
  });

  it('reports a container that fails', async () => {
    const docker: DockerExec = () => Promise.resolve({ ...ok, code: 125, stderr: 'no such image' });
    await expect(inspectWorkspace(docker, INPUT, {})).rejects.toThrow(
      'the scoring container exited with 125: no such image',
    );
  });
});

describe('readRunFolder', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'theoldman-folder-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('reads the plan and the runs in order, with or without a diff', () => {
    const dir = writeRunFolder(root, 'f', plan(), [{}, { diff: null }]);
    const folder = readRunFolder(dir);
    expect(folder.plan).toMatchObject({ condition: 'with', provider: { auth: 'api-key' } });
    expect(folder.runs.map((run) => [run.name, run.diff === null])).toEqual([
      ['with-1', false],
      ['with-2', true],
    ]);
    expect(folder.runs[0]?.record.result?.modelUsage['claude-sonnet-5-5']?.outputTokens).toBe(5000);
  });

  it('records a missing starter hash from an older runner as unknown', () => {
    const old = plan();
    old.task = { id: '_template', title: 'Template: add a clamp function' };
    expect(readRunFolder(writeRunFolder(root, 'f', old, [{}])).plan.task.starterHash).toBeNull();
  });

  it.each([
    [{ dryRun: true }, 'is a dry run'],
    [{ condition: 'both' }, 'condition is missing or malformed'],
    [{ provider: { name: 'vertex', auth: 'api-key' } }, 'provider is missing or malformed'],
  ])('rejects a plan it cannot score (%#)', (overrides, message) => {
    expect(() => readRunFolder(writeRunFolder(root, 'f', plan(overrides), [{}]))).toThrow(message);
  });

  it('rejects a run.json without the fields the scorers read', () => {
    const dir = writeRunFolder(root, 'f', plan(), [{ record: { result: { isError: false } } }]);
    expect(() => readRunFolder(dir)).toThrow('with-1/run.json is missing fields');
  });

  it('needs at least one run', () => {
    const dir = writeRunFolder(root, 'f', plan(), []);
    expect(() => readRunFolder(dir)).toThrow('has no runs');
  });
});

describe('modelLabel', () => {
  it.each([
    ['claude-sonnet-5-5', 'sonnet-5-5'],
    ['claude-sonnet-4-5-20250929', 'sonnet-4-5'],
    ['claude-3-5-haiku-20241022', '3-5-haiku'],
    ['us.anthropic.claude-sonnet-4-6', 'sonnet-4-6'],
    ['global.anthropic.claude-sonnet-4-5-20250929-v1:0', 'sonnet-4-5'],
  ])('labels %s as %s', (id, label) => {
    expect(modelLabel(id)).toBe(label);
  });

  it('cannot label an inference profile ARN', () => {
    expect(() =>
      modelLabel('arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/abc'),
    ).toThrow(ConfigError);
  });
});

describe('aggregate', () => {
  it('summarises each metric over the runs that measured it', () => {
    const result = aggregate(
      [
        { fillerComments: 1, tscErrors: 0, costUsd: 0.2 },
        { fillerComments: 3, costUsd: 0.4 },
      ],
      1,
      ['a'],
    );
    expect(result.runs).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.metrics.fillerComments).toEqual({ n: 2, mean: 2, sd: 1.4142, min: 1, max: 3 });
    expect(result.metrics.tscErrors).toEqual({ n: 1, mean: 0, sd: null, min: 0, max: 0 });
    expect(result.metrics.eslintErrors).toBeNull();
  });
});

describe('the results schema', () => {
  const valid: Results = {
    schemaVersion: 1,
    createdAt: '2026-11-27T12:00:00.000Z',
    date: '2026-11-27',
    label: 'sonnet-5-5',
    published: true,
    provider: { name: 'anthropic', auth: 'api-key' },
    models: {
      ANTHROPIC_MODEL: 'claude-sonnet-5-5',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-5-5',
      used: ['claude-sonnet-5-5'],
    },
    claudeCode: '2.1.332',
    notes: [],
    tasks: [
      {
        id: '_template',
        title: 'Template',
        conditions: { with: aggregate([{ fillerComments: 0 }], 0, ['f']) },
      },
    ],
  };

  it('accepts results with exact model IDs', () => {
    expect(() => {
      validateResults(valid);
    }).not.toThrow();
  });

  it.each([
    ['ANTHROPIC_MODEL', { ...valid.models, ANTHROPIC_MODEL: 'sonnet' }],
    ['ANTHROPIC_DEFAULT_SONNET_MODEL', { ...valid.models, ANTHROPIC_DEFAULT_SONNET_MODEL: 'opus' }],
    ['used', { ...valid.models, used: ['claude-sonnet-5-5', 'haiku'] }],
    ['used', { ...valid.models, used: ['claude-sonnet-latest'] }],
  ])('rejects an alias in models.%s', (field, models) => {
    expect(() => {
      validateResults({ ...valid, models });
    }).toThrow(`/models/${field}`);
  });

  it('rejects unknown fields and missing metrics', () => {
    expect(() => {
      validateResults({ ...valid, extra: true });
    }).toThrow(ConfigError);
    const task = valid.tasks[0];
    const broken = {
      ...task,
      conditions: { with: { runs: 1, failed: 0, runFolders: ['f'], metrics: {} } },
    };
    expect(() => {
      validateResults({ ...valid, tasks: [broken] });
    }).toThrow('must have required property');
  });

  it('agrees with the runner on which model IDs are exact', () => {
    const ids = [
      'claude-sonnet-5-5',
      'claude-sonnet-4-5-20250929',
      'us.anthropic.claude-sonnet-4-6',
      'anthropic.claude-3-5-haiku-20241022-v1:0',
      'arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/abc123',
      'sonnet',
      'haiku',
      'claude-sonnet',
      'claude-sonnet-latest',
      'sonnet[1m]',
    ];
    for (const id of ids) {
      const runner = isExactModelId('anthropic', id) || isExactModelId('bedrock', id);
      const schema = (() => {
        try {
          validateResults({ ...valid, models: { ...valid.models, used: [id] } });
          return true;
        } catch {
          return false;
        }
      })();
      expect([id, schema]).toEqual([id, runner]);
    }
  });

  it('writes <date>-<label>.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'theoldman-results-'));
    expect(writeResults(dir, valid)).toBe(join(dir, '2026-11-27-sonnet-5-5.json'));
    expect(writeResults(dir, { ...valid, published: false })).toBe(
      join(dir, '2026-11-27-sonnet-5-5-unpublished.json'),
    );
    rmSync(dir, { recursive: true, force: true });
  });
});
