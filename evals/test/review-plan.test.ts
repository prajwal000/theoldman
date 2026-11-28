import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DockerExec, ExecOptions, ExecResult } from '../src/docker.ts';
import { ConfigError } from '../src/errors.ts';
import { executeRuns } from '../src/execute.ts';
import { commitMessage, goldenPrHash, loadGoldenPr } from '../src/golden-pr.ts';
import type { Env } from '../src/provider.ts';
import {
  parseReviewArgs,
  planReview,
  prSetup,
  REVIEW_TIMEOUT_MINUTES,
  type ReviewArgs,
} from '../src/review-plan.ts';
import { transcript } from './result-event.ts';

const EVALS = fileURLToPath(new URL('../', import.meta.url));
const PRS = join(EVALS, 'golden-prs');
const PATHS = { dockerDir: join(EVALS, 'docker'), pluginDir: join(EVALS, '..', 'plugin') };
const KEY = 'sk-ant-api03-REVIEW-TEST-KEY';
const ENV: Env = { PATH: '/usr/bin', ANTHROPIC_API_KEY: KEY };

interface Call extends ExecOptions {
  readonly args: readonly string[];
}

function fakeDocker(): { docker: DockerExec; calls: Call[] } {
  const calls: Call[] = [];
  const docker: DockerExec = (args, options) => {
    calls.push({ args, ...options });
    const ok: ExecResult = { code: 0, stdout: '', stderr: '', timedOut: false };
    if (args[0] === 'version') return Promise.resolve({ ...ok, stdout: 'linux\n' });
    if (args.includes('claude')) return Promise.resolve({ ...ok, stdout: transcript() });
    return Promise.resolve(ok);
  };
  return { docker, calls };
}

describe('parseReviewArgs', () => {
  it('reads a golden PR, a condition and runs', () => {
    expect(parseReviewArgs(['--', '--pr', 'cancel-orders', '--condition', 'without'])).toEqual({
      pr: 'cancel-orders',
      condition: 'without',
      runs: 3,
      dryRun: false,
      publish: false,
    });
    expect(parseReviewArgs(['--help'])).toBeUndefined();
  });

  it.each([
    [['--condition', 'with'], /--pr is required/],
    [['--pr', '../x', '--condition', 'with'], /not a golden PR ID/],
    [['--pr', 'a', '--condition', 'maybe'], /--condition/],
    [['--pr', 'a', '--condition', 'with', '--runs', '0'], /--runs/],
    [['--pr', 'a', '--condition', 'with', '--task', 'x'], /Unknown option/],
  ])('refuses %j', (argv, message) => {
    expect(() => parseReviewArgs(argv)).toThrow(ConfigError);
    expect(() => parseReviewArgs(argv)).toThrow(message);
  });
});

describe('planReview', () => {
  let runsDir: string;
  beforeEach(() => {
    runsDir = join(mkdtempSync(join(tmpdir(), 'theoldman-review-')), 'runs');
  });
  afterEach(() => {
    rmSync(join(runsDir, '..'), { recursive: true, force: true });
  });

  const ARGS: ReviewArgs = {
    pr: 'admin-orders',
    condition: 'with',
    runs: 1,
    dryRun: true,
    publish: false,
  };

  it('writes a review plan with the PR hash, and no credential or golden comment', () => {
    const { dir, plan, task } = planReview(ARGS, ENV, { prsDir: PRS, runsDir });
    const pr = loadGoldenPr(PRS, 'admin-orders');
    expect(plan).toMatchObject({
      kind: 'review',
      task: { id: 'admin-orders', timeoutMinutes: REVIEW_TIMEOUT_MINUTES, services: [] },
      pr: { branch: 'admin-orders', hash: goldenPrHash(pr) },
      provider: { name: 'anthropic', auth: 'api-key', env: ['ANTHROPIC_API_KEY'] },
    });
    expect(task.prompt).toBe('/theoldman:review');
    const without = planReview({ ...ARGS, condition: 'without' }, ENV, { prsDir: PRS, runsDir });
    expect(without.task.prompt).toBe(readFileSync(join(PRS, 'prompt-without.md'), 'utf8').trim());
    expect(dir).toMatch(/review-/);
    const saved = readFileSync(join(dir, 'plan.json'), 'utf8');
    expect(saved).not.toContain(KEY);
    for (const comment of pr.comments) expect(saved).not.toContain(comment.issue);
  });

  it('refuses publication with model aliases or a subscription token', () => {
    const publish = { ...ARGS, publish: true };
    const aliases = { ...ENV, ANTHROPIC_MODEL: 'sonnet', ANTHROPIC_DEFAULT_SONNET_MODEL: 'sonnet' };
    expect(() => planReview(publish, aliases, { prsDir: PRS, runsDir })).toThrow(/exact model/);
    const token = { PATH: '/usr/bin', CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-TEST-TOKEN' };
    expect(() => planReview(publish, token, { prsDir: PRS, runsDir })).toThrow(/ANTHROPIC_API_KEY/);
  });

  it('runs the PR setup after the baseline and before Claude, with the PR on stdin', async () => {
    const planned = planReview({ ...ARGS, dryRun: false }, ENV, { prsDir: PRS, runsDir });
    const { docker, calls } = fakeDocker();
    const records = await executeRuns({
      plan: planned.plan,
      task: planned.task,
      provider: planned.provider,
      setup: prSetup(planned.pr),
      runDir: planned.dir,
      env: ENV,
      paths: PATHS,
      docker,
    });
    expect(records.map((record) => record.error)).toEqual([null]);

    const execs = calls
      .filter((call) => call.args[0] === 'compose' && call.args.includes('exec'))
      .map((call) => ({
        args: call.args.slice(call.args.indexOf('agent') + 1),
        input: call.input,
      }));
    const pr = planned.pr;
    expect(execs.map(({ args }) => args.slice(0, 3).join(' '))).toEqual([
      'chown -R node:node',
      'sh -c git init -q && git add -A && git -c user.name=theoldman-eval -c user.email=eval@theoldman.invalid commit -q --allow-empty -m baseline',
      'git branch -M',
      'git checkout -q',
      'git apply --index',
      'git -c user.name=theoldman-eval',
      expect.stringMatching(/^claude -p/),
      expect.stringMatching(/^sh -c git add -A/),
    ]);
    expect(execs[3]?.args).toEqual(['git', 'checkout', '-q', '-b', 'admin-orders']);
    expect(execs[4]?.input).toBe(pr.patch);
    expect(execs[5]?.args.slice(-4)).toEqual(['commit', '-q', '-F', '-']);
    expect(execs[5]?.input).toBe(commitMessage(pr));
    expect(execs[6]?.input).toBe(planned.task.prompt);
    expect(execs[6]?.args).toContain('--plugin-dir');

    // The PR's text reaches the container only on stdin, and the golden comments never do.
    const commandLines = calls.map((call) => call.args.join('\n')).join('\n');
    expect(commandLines).not.toContain(pr.title);
    const sent = calls.map((call) => `${call.args.join('\n')}\n${call.input ?? ''}`).join('\n');
    for (const comment of pr.comments) expect(sent).not.toContain(comment.issue);
    expect(readdirSync(planned.dir).sort()).toEqual(['plan.json', 'with-1']);
  });
});
