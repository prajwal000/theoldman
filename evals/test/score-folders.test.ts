import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DockerExec, ExecOptions } from '../src/docker.ts';
import { ConfigError } from '../src/errors.ts';
import { SCORE_IMAGE, SEMGREP_RULES_COMMIT } from '../src/images.ts';
import { validateResults } from '../src/score/results.ts';
import { readRunFolder } from '../src/score/run-folder.ts';
import { scoreFolders } from '../src/score/score-folders.ts';
import { CLAMPED_MATH, DOCKER_DIR, plan, TASKS, usage, writeRunFolder } from './run-folders.ts';

interface Call extends ExecOptions {
  readonly args: readonly string[];
}

/** Docker that answers each scoring container with `report`. */
function fakeDocker(report: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  const docker: DockerExec = (args, options) => {
    calls.push({ args, ...options });
    const ok = { code: 0, stdout: '', stderr: '', timedOut: false };
    if (args[0] === 'version') return Promise.resolve({ ...ok, stdout: 'linux\n' });
    if (args[0] === 'run') {
      const body = {
        notes: ['no eslint.config file: ESLint not run'],
        files: { 'src/math.ts': CLAMPED_MATH },
        envExamples: {},
        tsc: { errors: 0 },
        eslint: null,
        semgrep: { findings: [{ rule: 'eval-detected', path: 'src/math.ts', line: 5 }] },
        gitleaks: { findings: [] },
        tests: {
          hidden: [HIDDEN],
          starter: { [HIDDEN]: { passed: 0, failed: 3, skipped: 0, loaded: true } },
          final: {
            [HIDDEN]: { passed: 3, failed: 0, skipped: 0, loaded: true },
            'src/math.test.ts': { passed: 2, failed: 0, skipped: 0, loaded: true },
          },
        },
        ...report,
      };
      return Promise.resolve({ ...ok, stdout: `${JSON.stringify(body)}\n` });
    }
    return Promise.resolve(ok);
  };
  return { docker, calls };
}

const ENV = { PATH: '/usr/bin', ANTHROPIC_API_KEY: 'sk-ant-api03-NOT-FOR-SCORING' };
const HIDDEN = 'src/math.hidden.test.ts';

describe('scoreFolders', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'theoldman-score-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const folder = (name: string, overrides: Record<string, unknown>, runs = [{}]) =>
    readRunFolder(writeRunFolder(root, name, plan(overrides), runs));

  const score = (folders: ReturnType<typeof folder>[], docker: DockerExec) =>
    scoreFolders({
      folders,
      tasksDir: TASKS,
      dockerDir: DOCKER_DIR,
      env: ENV,
      docker,
      now: new Date('2026-11-27T12:00:00.000Z'),
    });

  it('scores both conditions of a task into results that match the schema', async () => {
    const { docker, calls } = fakeDocker();
    const withRuns = folder('w', { condition: 'with' }, [{}, {}]);
    const lessRecord = {
      result: {
        isError: false,
        totalCostUsd: 0.02,
        durationMs: 5000,
        modelUsage: { 'claude-sonnet-5-5': usage(300, 0.02) },
      },
      wallTimeMs: 6000,
    };
    const withoutRuns = folder(
      'wo',
      { condition: 'without', createdAt: '2026-11-28T09:00:00.000Z' },
      [{ record: lessRecord }],
    );
    const results = await score([withRuns, withoutRuns], docker);

    expect(() => {
      validateResults(results);
    }).not.toThrow();
    expect(results).toMatchObject({
      date: '2026-11-28',
      label: 'sonnet-5-5',
      published: true,
      provider: { name: 'anthropic', auth: 'api-key' },
      models: { ANTHROPIC_MODEL: 'claude-sonnet-5-5', used: ['claude-sonnet-5-5'] },
      notes: ['_template: no eslint.config file: ESLint not run'],
    });
    const [task] = results.tasks;
    expect(task?.conditions.with).toMatchObject({
      runs: 2,
      failed: 0,
      runFolders: ['w'],
      metrics: {
        fillerComments: { n: 2, mean: 1 },
        fillerPer100Lines: { mean: 33.3333 },
        tscErrors: { mean: 0 },
        eslintErrors: null,
        semgrepFindings: { mean: 1 },
        gitleaksFindings: { mean: 0 },
        hiddenTestsPassRate: { mean: 1 },
        testsAdded: { mean: 2 },
        docsFindings: { mean: 0 },
        docsInSync: { mean: 1 },
        outputTokens: { mean: 5000 },
        minutes: { mean: 1.5 },
      },
    });
    expect(task?.conditions.without?.metrics.costUsd).toMatchObject({ mean: 0.02 });
    expect(calls.filter((call) => call.args[0] === 'run')).toHaveLength(3);
  });

  it('scores in the scoring image, built from its own Dockerfile target', async () => {
    const { docker, calls } = fakeDocker();
    await score([folder('w', {})], docker);
    const build = calls.find((call) => call.args[0] === 'build')?.args ?? [];
    expect(build.join(' ')).toContain('--target score');
    expect(build).toContain(`SEMGREP_RULES_COMMIT=${SEMGREP_RULES_COMMIT}`);
    expect(build).toContain(SCORE_IMAGE);
    const run = calls.find((call) => call.args[0] === 'run')?.args ?? [];
    expect(run).toContain(SCORE_IMAGE);
    expect(run.join(' ')).toContain('target=/hidden,readonly');
  });

  it('refuses a task with services, which scoring cannot start yet', async () => {
    const tasksDir = join(root, 'tasks');
    cpSync(join(TASKS, '_template'), join(tasksDir, 'with-db'), { recursive: true });
    writeFileSync(
      join(tasksDir, 'with-db', 'task.json'),
      JSON.stringify({
        title: 'Template with a database',
        starter: 'starter',
        hiddenTests: 'hidden',
        timeoutMinutes: 15,
        services: ['postgres'],
      }),
    );
    const withDb = plan();
    withDb.task = { ...(withDb.task as object), id: 'with-db' };
    const folders = [readRunFolder(writeRunFolder(root, 'db', withDb, [{}]))];
    const { docker, calls } = fakeDocker();
    await expect(
      scoreFolders({ folders, tasksDir, dockerDir: DOCKER_DIR, env: ENV, docker }),
    ).rejects.toThrow('db: task with-db uses postgres, and scoring does not start services yet');
    expect(calls).toEqual([]);
  });

  it("counts docs findings on the run's diff, and a tool that could not scan as no value", async () => {
    const diff = `diff --git a/src/config.ts b/src/config.ts
new file mode 100644
--- /dev/null
+++ b/src/config.ts
@@ -0,0 +1 @@
+export const port = process.env.PORT;
`;
    const files = { 'src/config.ts': 'export const port = process.env.PORT;\n' };
    const results = await score(
      [folder('w', {}, [{ diff }])],
      fakeDocker({ files, semgrep: null }).docker,
    );
    expect(results.tasks[0]?.conditions.with?.metrics).toMatchObject({
      docsFindings: { mean: 1 },
      docsInSync: { mean: 0 },
      semgrepFindings: null,
    });
  });

  it('gives the scoring containers no credentials', async () => {
    const { docker, calls } = fakeDocker();
    await score([folder('w', {})], docker);
    for (const call of calls) {
      expect(call.env.ANTHROPIC_API_KEY).toBeUndefined();
      expect(call.args.join(' ')).not.toContain(ENV.ANTHROPIC_API_KEY);
    }
  });

  it('counts runs that did not finish as failed, without scoring them', async () => {
    const { docker, calls } = fakeDocker();
    const runs = [
      {},
      { record: { error: 'Claude Code timed out after 15 minutes' } },
      { diff: null },
    ];
    const results = await score([folder('w', {}, runs)], docker);
    expect(results.tasks[0]?.conditions.with).toMatchObject({ runs: 1, failed: 2 });
    expect(calls.filter((call) => call.args[0] === 'run')).toHaveLength(1);
  });

  it('counts a run whose diff does not apply as failed, with a note', async () => {
    const good = fakeDocker();
    let containers = 0;
    const docker: DockerExec = (args, options) => {
      if (args[0] === 'run' && ++containers === 1) {
        const report = { notes: [], error: "the run's diff does not apply to the starter" };
        return Promise.resolve({
          code: 0,
          stdout: JSON.stringify(report),
          stderr: '',
          timedOut: false,
        });
      }
      return good.docker(args, options);
    };
    const results = await score([folder('w', {}, [{}, {}])], docker);
    expect(results.tasks[0]?.conditions.with).toMatchObject({ runs: 1, failed: 1 });
    expect(results.notes).toContain("w/with-1: the run's diff does not apply to the starter");
  });

  it('refuses when no run could be scored', async () => {
    const { docker } = fakeDocker({ error: 'does not apply' });
    await expect(score([folder('w', {})], docker)).rejects.toThrow('nothing to score');
  });

  it('marks results unpublished unless every run was published on an API key', async () => {
    const token = { provider: { name: 'anthropic', auth: 'subscription-token' } };
    expect((await score([folder('t', token)], fakeDocker().docker)).published).toBe(false);
    expect((await score([folder('p', { publish: false })], fakeDocker().docker)).published).toBe(
      false,
    );
  });

  it('notes a run that did not record its starter', async () => {
    const old = plan();
    old.task = { id: '_template', title: 'Template: add a clamp function' };
    const results = await score(
      [readRunFolder(writeRunFolder(root, 'old', old, [{}]))],
      fakeDocker().docker,
    );
    expect(results.notes).toContain(
      'old: the run did not record its starter; scored against the current one.',
    );
  });

  it.each([
    [
      [
        {},
        {
          models: {
            ANTHROPIC_MODEL: 'claude-opus-5-5',
            ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-5-5',
          },
        },
      ],
      'different providers, models or Claude Code versions',
    ],
    [[{}, { claudeCode: '2.1.400' }], 'different providers, models or Claude Code versions'],
    [
      [
        {
          models: {
            ANTHROPIC_MODEL: 'sonnet',
            ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-5-5',
          },
        },
      ],
      'exact model IDs, but ANTHROPIC_MODEL was "sonnet"',
    ],
    [
      [{ models: { ANTHROPIC_MODEL: 'claude-sonnet-5-5', ANTHROPIC_DEFAULT_SONNET_MODEL: null } }],
      'ANTHROPIC_DEFAULT_SONNET_MODEL was not set',
    ],
  ])('refuses folders it cannot score together (%#)', async (plans, message) => {
    const folders = plans.map((overrides, i) => folder(`f${String(i)}`, overrides));
    const { docker, calls } = fakeDocker();
    await expect(score(folders, docker)).rejects.toThrow(message);
    expect(calls).toEqual([]);
  });

  it('refuses a run whose starter changed since', async () => {
    const changed = plan();
    changed.task = { ...(changed.task as object), starterHash: 'sha256:0000' };
    const folders = [readRunFolder(writeRunFolder(root, 'c', changed, [{}]))];
    await expect(score(folders, fakeDocker().docker)).rejects.toThrow(
      new ConfigError(
        'c: the starter of task _template changed since the run, so its diff cannot be scored against it.',
      ).message,
    );
  });
});
