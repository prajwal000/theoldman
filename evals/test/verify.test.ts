import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DockerExec } from '../src/docker.ts';
import { judge, verifyTasks } from '../src/score/verify.ts';
import type { WorkspaceReport } from '../src/score/workspace.ts';
import { loadTask } from '../src/task.ts';
import { CLAMP_DIFF, CLAMPED_MATH, DOCKER_DIR, TASKS } from './run-folders.ts';

const HIDDEN = 'src/math.hidden.test.ts';
const counts = (passed: number, failed: number) => ({ passed, failed, skipped: 0, loaded: true });

/** A clean report: hidden tests passing (or failing) and no findings. */
function report(passed: boolean, overrides: Partial<WorkspaceReport> = {}): WorkspaceReport {
  return {
    files: { 'src/math.ts': CLAMPED_MATH.replace('// Added clamp function\n', '') },
    envExamples: {},
    tsc: { errors: 0 },
    eslint: { errors: 0, warnings: 0 },
    build: null,
    semgrep: [],
    gitleaks: [],
    tests: {
      hidden: [HIDDEN],
      starter: { [HIDDEN]: counts(0, 3) },
      final: { [HIDDEN]: passed ? counts(3, 0) : counts(0, 3) },
    },
    notes: [],
    error: null,
    ...overrides,
  };
}

/** The JSON line the scoring container prints for a report. */
const containerJson = (value: WorkspaceReport): string =>
  JSON.stringify({
    ...value,
    semgrep: value.semgrep === null ? null : { findings: value.semgrep },
    gitleaks: value.gitleaks === null ? null : { findings: value.gitleaks },
  });

const template = loadTask(TASKS, '_template');
const CLEAN_DIFF = CLAMP_DIFF.replace('+// Added clamp function\n', '').replace('+1,6', '+1,5');

describe('judge', () => {
  it('passes a starter that fails every hidden test and a clean reference that passes them', () => {
    expect(judge(template, 'starter', '', report(false)).problems).toEqual([]);
    expect(judge(template, 'reference', CLEAN_DIFF, report(true))).toEqual({
      task: '_template',
      kind: 'reference',
      hiddenPassRate: 1,
      problems: [],
    });
  });

  it('fails a starter that passes a hidden test, and one whose hidden file does not load', () => {
    const passing = report(false, {
      tests: {
        hidden: [HIDDEN],
        starter: { [HIDDEN]: counts(1, 2) },
        final: { [HIDDEN]: counts(1, 2) },
      },
    });
    expect(judge(template, 'starter', '', passing).problems[0]).toMatch(/pass rate is 0.333/);
    const unloaded = report(false, {
      tests: {
        hidden: [HIDDEN],
        starter: { [HIDDEN]: { passed: 0, failed: 0, skipped: 0, loaded: false } },
        final: { [HIDDEN]: { passed: 0, failed: 0, skipped: 0, loaded: false } },
      },
    });
    expect(judge(template, 'starter', '', unloaded).problems.join(' ')).toMatch(/did not load/);
  });

  it('lists every finding on a reference', () => {
    const findings = report(false, {
      files: { 'src/math.ts': CLAMPED_MATH },
      tsc: { errors: 2 },
      eslint: null,
      build: { ok: false },
      semgrep: [{ rule: 'eval-detected', path: 'src/math.ts', line: 5, endLine: 5 }],
      notes: ['npm install failed: E404'],
    });
    const problems = judge(template, 'reference', CLAMP_DIFF, findings).problems;
    expect(problems).toEqual([
      'npm install failed: E404',
      'every hidden test should pass with the reference, but the pass rate is 0',
      'tsc: 2 errors',
      'ESLint: did not run',
      'next build failed',
      'security findings: Semgrep 1, gitleaks 0 (eval-detected)',
      '1 filler comments (OLDMAN-C01)',
    ]);
  });

  it('reports a diff that does not apply', () => {
    const broken = { ...report(true), error: 'the diff does not apply' };
    expect(judge(template, 'reference', CLAMP_DIFF, broken).problems).toEqual([
      'the diff does not apply',
    ]);
  });
});

describe('verifyTasks', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'theoldman-verify-test-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('scores the starter with an empty diff and the reference with its patch', async () => {
    const tasksDir = join(root, 'tasks');
    cpSync(join(TASKS, '_template'), join(tasksDir, 'sample'), { recursive: true });
    writeFileSync(join(tasksDir, 'sample', 'reference.patch'), CLEAN_DIFF);
    const task = loadTask(tasksDir, 'sample');

    const diffs: string[] = [];
    const docker: DockerExec = (args) => {
      const ok = { code: 0, stdout: '', stderr: '', timedOut: false };
      if (args[0] === 'version') return Promise.resolve({ ...ok, stdout: 'linux\n' });
      if (args[0] === 'run' && args.includes('/score/report.mjs')) {
        const runMount = args.find((arg) => arg.includes('target=/run,'));
        const starter = runMount?.includes('sample-starter') ?? false;
        diffs.push(starter ? 'starter' : 'reference');
        return Promise.resolve({ ...ok, stdout: containerJson(report(!starter)) });
      }
      return Promise.resolve(ok);
    };
    const verdicts = await verifyTasks({
      tasks: [task],
      dockerDir: DOCKER_DIR,
      env: { PATH: '/usr/bin' },
      docker,
      workDir: join(root, 'work'),
    });
    expect(diffs).toEqual(['starter', 'reference']);
    expect(verdicts.map((verdict) => [verdict.kind, verdict.problems])).toEqual([
      ['starter', []],
      ['reference', []],
    ]);
  });

  it('fails a task without a reference.patch', async () => {
    const docker: DockerExec = (args) =>
      Promise.resolve({
        code: 0,
        stdout: args[0] === 'version' ? 'linux\n' : containerJson(report(false)),
        stderr: '',
        timedOut: false,
      });
    const verdicts = await verifyTasks({
      tasks: [template],
      dockerDir: DOCKER_DIR,
      env: {},
      docker,
      workDir: join(root, 'work'),
    });
    expect(verdicts[0]?.problems).toEqual(['the task has no reference.patch']);
  });
});
