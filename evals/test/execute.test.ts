import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RunArgs } from '../src/args.ts';
import { claudeArgs, PLUGIN_DIR_IN_CONTAINER } from '../src/claude.ts';
import {
  type DockerExec,
  type ExecOptions,
  type ExecResult,
  InterruptedError,
} from '../src/docker.ts';
import { ConfigError } from '../src/errors.ts';
import { DATABASE_URL, executeRuns, INTERRUPTED, type RunRecord } from '../src/execute.ts';
import { AGENT_IMAGE, IMAGES, imageRefs } from '../src/images.ts';
import { planRun } from '../src/plan.ts';
import type { Env } from '../src/provider.ts';
import { REDACTED } from '../src/secrets.ts';
import { transcript } from './result-event.ts';

const EVALS = fileURLToPath(new URL('../', import.meta.url));
const PATHS = { dockerDir: join(EVALS, 'docker'), pluginDir: join(EVALS, '..', 'plugin') };
const KEY = 'sk-ant-api03-TEST-KEY-NEVER-SAVED';
const ENV: Env = {
  PATH: '/usr/bin',
  ANTHROPIC_API_KEY: KEY,
  AWS_SECRET_ACCESS_KEY: 'aws-not-used',
};
const [HUB_NODE, ECR_NODE] = imageRefs(IMAGES.node);
const DIFF_TEXT = 'diff --git a/src/math.ts b/src/math.ts\n+export function clamp() {}\n';

interface Call extends ExecOptions {
  readonly args: readonly string[];
}

type Respond = (args: readonly string[]) => Partial<ExecResult> | undefined;

function fakeDocker(respond: Respond = () => undefined): { docker: DockerExec; calls: Call[] } {
  const calls: Call[] = [];
  const docker: DockerExec = (args, options) => {
    calls.push({ args, ...options });
    const base: ExecResult = { code: 0, stdout: '', stderr: '', timedOut: false };
    const custom = respond(args);
    if (custom !== undefined) return Promise.resolve({ ...base, ...custom });
    if (args[0] === 'version') return Promise.resolve({ ...base, stdout: 'linux\n' });
    if (args.includes('claude')) return Promise.resolve({ ...base, stdout: transcript() });
    if (args.some((arg) => arg.includes('git diff'))) {
      return Promise.resolve({ ...base, stdout: DIFF_TEXT });
    }
    return Promise.resolve(base);
  };
  return { docker, calls };
}

const isClaude = (call: Call): boolean => call.args.includes('claude');
const VERBS = new Set(['up', 'cp', 'exec', 'down']);
const composeVerb = (call: Call): string | undefined =>
  call.args[0] === 'compose' ? call.args.find((arg) => VERBS.has(arg)) : undefined;

describe('executeRuns', () => {
  let runsDir: string;
  beforeEach(() => {
    runsDir = join(mkdtempSync(join(tmpdir(), 'theoldman-exec-')), 'runs');
  });
  afterEach(() => {
    rmSync(join(runsDir, '..'), { recursive: true, force: true });
  });

  async function execute(
    args: Partial<RunArgs>,
    docker: DockerExec,
    env: Env = ENV,
  ): Promise<{ records: RunRecord[]; dir: string }> {
    const planned = planRun(
      { task: '_template', condition: 'with', runs: 1, dryRun: false, publish: false, ...args },
      env,
      { tasksDir: join(EVALS, 'tasks'), runsDir },
    );
    const records = await executeRuns({
      ...planned,
      runDir: planned.dir,
      env,
      paths: PATHS,
      docker,
    });
    return { records, dir: planned.dir };
  }

  it('runs one "with" run end to end and saves its files', async () => {
    const { docker, calls } = fakeDocker();
    const { records, dir } = await execute({}, docker);

    expect(calls.map((call) => composeVerb(call) ?? call.args[0])).toEqual([
      'version',
      'ps',
      'pull',
      'build',
      'up',
      'cp',
      'cp',
      'exec',
      'exec',
      'exec',
      'exec',
      'down',
    ]);
    const build = calls.find((call) => call.args[0] === 'build')?.args ?? [];
    expect(build).toContain(`NODE_IMAGE=${HUB_NODE ?? ''}`);
    expect(build).toContain(AGENT_IMAGE);
    // The agent target leaves out the scoring tools, so Claude cannot use them during a run.
    expect(build.join(' ')).toContain('--target agent');
    expect(build.join(' ')).not.toMatch(/SEMGREP|GITLEAKS/);
    // Labelled with this process, so a later run can remove the project if this one is killed.
    const up = calls.find((call) => composeVerb(call) === 'up');
    expect(up?.env.THEOLDMAN_OWNER).toBe(String(process.pid));
    const pluginCopy = calls.find((call) => call.args.includes(`agent:${PLUGIN_DIR_IN_CONTAINER}`));
    expect(pluginCopy).toBeDefined();

    const claude = calls.find(isClaude);
    expect(claude?.args.slice(-claudeArgs('with').length)).toEqual(claudeArgs('with'));
    expect(claude?.input).toMatch(/^Add a `clamp\(value, min, max\)` function/);
    expect(claude?.timeoutMs).toBe(15 * 60_000);
    expect(claude?.env.AGENT_IMAGE).toBe(AGENT_IMAGE);

    expect(readdirSync(join(dir, 'with-1')).sort()).toEqual([
      'diff.patch',
      'run.json',
      'stderr.log',
      'transcript.jsonl',
    ]);
    expect(readFileSync(join(dir, 'with-1', 'diff.patch'), 'utf8')).toBe(DIFF_TEXT);
    const record = JSON.parse(readFileSync(join(dir, 'with-1', 'run.json'), 'utf8')) as unknown;
    expect(record).toEqual(JSON.parse(JSON.stringify(records[0])));
    expect(records[0]).toMatchObject({
      condition: 'with',
      run: 1,
      exitCode: 0,
      timedOut: false,
      error: null,
      images: { node: HUB_NODE },
      result: { models: ['claude-sonnet-5-5'], numTurns: 11, totalCostUsd: 0.226 },
    });
    expect(records[0]?.wallTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('runs "without" with the same steps and flags, minus the plugin', async () => {
    const withRun = fakeDocker();
    await execute({}, withRun.docker);
    const withoutRun = fakeDocker();
    await execute({ condition: 'without' }, withoutRun.docker);

    const pluginCopies = withoutRun.calls.filter((call) =>
      call.args.includes(`agent:${PLUGIN_DIR_IN_CONTAINER}`),
    );
    expect(pluginCopies).toEqual([]);
    const claudeWith = withRun.calls.find(isClaude)?.args ?? [];
    const claudeWithout = withoutRun.calls.find(isClaude)?.args ?? [];
    const flags = (args: readonly string[]): string[] => args.slice(args.indexOf('claude'));
    expect(flags(claudeWith)).toEqual([
      ...flags(claudeWithout),
      '--plugin-dir',
      PLUGIN_DIR_IN_CONTAINER,
    ]);
  });

  it('runs Claude Code only through docker compose exec', async () => {
    const { docker, calls } = fakeDocker();
    await execute({ runs: 2 }, docker);
    const bypass = calls.filter((call) => call.args.includes('bypassPermissions'));
    expect(bypass).toHaveLength(2);
    for (const call of bypass) {
      expect(call.args[0]).toBe('compose');
      expect(composeVerb(call)).toBe('exec');
      expect(call.args).toContain('agent');
    }
  });

  it('uses a fresh Compose project per run and removes it afterwards', async () => {
    const { docker, calls } = fakeDocker();
    await execute({ runs: 2 }, docker);
    const projects = calls
      .filter((call) => composeVerb(call) === 'up' || composeVerb(call) === 'down')
      .map((call) => `${composeVerb(call) ?? ''} ${call.args[2] ?? ''}`);
    expect(projects).toHaveLength(4);
    expect(projects[0]?.replace('up', 'down')).toBe(projects[1]);
    expect(projects[2]?.replace('up', 'down')).toBe(projects[3]);
    expect(projects[0]).not.toBe(projects[2]);
  });

  it('falls back to the ECR Public mirror when Docker Hub fails', async () => {
    const { docker, calls } = fakeDocker((args) =>
      args[0] === 'pull' && args[2] === HUB_NODE
        ? { code: 1, stderr: 'net/http: TLS handshake timeout' }
        : undefined,
    );
    const { records } = await execute({}, docker);
    expect(calls.filter((call) => call.args[0] === 'pull').map((call) => call.args[2])).toEqual([
      HUB_NODE,
      ECR_NODE,
    ]);
    expect(calls.find((call) => call.args[0] === 'build')?.args).toContain(
      `NODE_IMAGE=${ECR_NODE ?? ''}`,
    );
    expect(records[0]?.images).toEqual({ node: ECR_NODE });
  });

  it('fails clearly when neither registry answers', async () => {
    const { docker } = fakeDocker((args) =>
      args[0] === 'pull' ? { code: 1, stderr: 'TLS handshake timeout' } : undefined,
    );
    await expect(execute({}, docker)).rejects.toThrow(
      /Could not pull any of:\n.*docker\.io.*\n.*public\.ecr\.aws/,
    );
  });

  it('passes the key by name only and saves nothing that contains it', async () => {
    const leak = `ANTHROPIC_API_KEY=${KEY}`;
    const { docker, calls } = fakeDocker((args) => {
      if (args.includes('claude')) return { stdout: transcript(undefined, [leak]), stderr: leak };
      if (args.some((arg) => arg.includes('git diff')))
        return { stdout: `+const key = '${KEY}';\n` };
      return undefined;
    });
    const { dir } = await execute({}, docker);

    for (const call of calls) {
      expect(call.args.join(' ')).not.toContain(KEY);
      expect(call.env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    }
    expect(calls.find(isClaude)?.env.ANTHROPIC_API_KEY).toBe(KEY);
    for (const file of readdirSync(join(dir, 'with-1'))) {
      expect(readFileSync(join(dir, 'with-1', file), 'utf8')).not.toContain(KEY);
    }
    expect(readFileSync(join(dir, 'with-1', 'transcript.jsonl'), 'utf8')).toContain(
      `ANTHROPIC_API_KEY=${REDACTED}`,
    );
  });

  it('runs on a subscription token the same way, and saves nothing that contains it', async () => {
    const token = 'sk-ant-oat01-TEST-TOKEN-NEVER-SAVED';
    const { docker, calls } = fakeDocker((args) =>
      args.includes('claude') ? { stdout: transcript(undefined, [`token=${token}`]) } : undefined,
    );
    const { dir, records } = await execute({}, docker, {
      PATH: '/usr/bin',
      CLAUDE_CODE_OAUTH_TOKEN: token,
    });
    expect(records[0]?.error).toBeNull();
    expect(calls.find(isClaude)?.env.CLAUDE_CODE_OAUTH_TOKEN).toBe(token);
    expect(calls.find(isClaude)?.env.ANTHROPIC_API_KEY).toBeUndefined();
    for (const call of calls) expect(call.args.join(' ')).not.toContain(token);
    for (const file of readdirSync(join(dir, 'with-1'))) {
      expect(readFileSync(join(dir, 'with-1', file), 'utf8')).not.toContain(token);
    }
  });

  it('on Ctrl+C stops the current run, removes its containers and starts no other run', async () => {
    const controller = new AbortController();
    const { docker, calls } = fakeDocker((args) => {
      if (!args.includes('claude')) return undefined;
      // What a killed `docker compose exec` returns.
      controller.abort();
      return { code: null, stdout: '' };
    });
    const planned = planRun(
      { task: '_template', condition: 'with', runs: 3, dryRun: false, publish: false },
      ENV,
      { tasksDir: join(EVALS, 'tasks'), runsDir },
    );
    const records = await executeRuns({
      ...planned,
      runDir: planned.dir,
      env: ENV,
      paths: PATHS,
      docker,
      signal: controller.signal,
    });

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ interrupted: true, error: INTERRUPTED, timedOut: false });
    expect(existsSync(join(planned.dir, 'with-1', 'diff.patch'))).toBe(false);
    expect(existsSync(join(planned.dir, 'with-1', 'run.json'))).toBe(true);
    expect(calls.filter((call) => composeVerb(call) === 'up')).toHaveLength(1);
    const downs = calls.filter((call) => composeVerb(call) === 'down');
    expect(downs).toHaveLength(1);
    expect(downs[0]?.signal).toBeUndefined();
    expect(calls.find(isClaude)?.signal).toBe(controller.signal);
  });

  it('on Ctrl+C during a setup step still removes the containers', async () => {
    const controller = new AbortController();
    const { docker, calls } = fakeDocker((args) => {
      if (!args.includes('cp')) return undefined;
      controller.abort();
      return { code: null };
    });
    const planned = planRun(
      { task: '_template', condition: 'with', runs: 2, dryRun: false, publish: false },
      ENV,
      { tasksDir: join(EVALS, 'tasks'), runsDir },
    );
    const records = await executeRuns({
      ...planned,
      runDir: planned.dir,
      env: ENV,
      paths: PATHS,
      docker,
      signal: controller.signal,
    });
    expect(records).toEqual([expect.objectContaining({ interrupted: true, error: INTERRUPTED })]);
    expect(calls.some(isClaude)).toBe(false);
    expect(composeVerb(calls.at(-1) ?? { args: [], env: {} })).toBe('down');
  });

  it('on Ctrl+C before the image is ready starts no container', async () => {
    const controller = new AbortController();
    const { docker, calls } = fakeDocker((args) => {
      if (args[0] !== 'pull') return undefined;
      controller.abort();
      return { code: null };
    });
    const planned = planRun(
      { task: '_template', condition: 'with', runs: 1, dryRun: false, publish: false },
      ENV,
      { tasksDir: join(EVALS, 'tasks'), runsDir },
    );
    await expect(
      executeRuns({
        ...planned,
        runDir: planned.dir,
        env: ENV,
        paths: PATHS,
        docker,
        signal: controller.signal,
      }),
    ).rejects.toThrow(InterruptedError);
    expect(calls.map((call) => call.args[0])).toEqual(['version', 'ps', 'pull']);
  });

  it('records a timeout, skips the diff and still removes the containers', async () => {
    const { docker, calls } = fakeDocker((args) =>
      args.includes('claude') ? { code: null, timedOut: true, stdout: '' } : undefined,
    );
    const { records, dir } = await execute({}, docker);
    expect(records[0]).toMatchObject({
      timedOut: true,
      error: 'Claude Code timed out after 15 minutes',
      result: null,
    });
    expect(existsSync(join(dir, 'with-1', 'diff.patch'))).toBe(false);
    expect(composeVerb(calls.at(-1) ?? { args: [], env: {} })).toBe('down');
  });

  it('records a failed step, removes the containers and goes on with the next run', async () => {
    let ups = 0;
    const { docker, calls } = fakeDocker((args) => {
      if (!args.includes('up')) return undefined;
      ups++;
      return ups === 1 ? { code: 1, stderr: `container failed\nkey ${KEY}` } : undefined;
    });
    const { records } = await execute({ runs: 2 }, docker);
    expect(records[0]?.error).toMatch(
      /^docker compose -p .* exited with 1:\ncontainer failed\nkey \[redacted\]$/,
    );
    expect(records[1]?.error).toBeNull();
    expect(calls.filter((call) => composeVerb(call) === 'down')).toHaveLength(2);
  });

  it('records a run whose transcript has no result', async () => {
    const { docker } = fakeDocker((args) =>
      args.includes('claude') ? { code: 1, stdout: '', stderr: 'Invalid API key' } : undefined,
    );
    const { records } = await execute({}, docker);
    expect(records[0]).toMatchObject({
      exitCode: 1,
      result: null,
      error: 'the transcript has no result event',
    });
  });

  it('starts Postgres for a task that asks for it', async () => {
    const { docker, calls } = fakeDocker();
    const planned = planRun(
      { task: '_template', condition: 'with', runs: 1, dryRun: false, publish: false },
      ENV,
      { tasksDir: join(EVALS, 'tasks'), runsDir },
    );
    const task = { ...planned.task, services: ['postgres'] as const };
    const records = await executeRuns({
      ...planned,
      task,
      runDir: planned.dir,
      env: ENV,
      paths: PATHS,
      docker,
    });
    expect(records[0]?.error).toBeNull();

    const [hubPostgres] = imageRefs(IMAGES.postgres);
    expect(calls.filter((call) => call.args[0] === 'pull').map((call) => call.args[2])).toEqual([
      HUB_NODE,
      hubPostgres,
    ]);
    const up = calls.find((call) => composeVerb(call) === 'up');
    expect(up?.args).toEqual(expect.arrayContaining(['--profile', 'postgres']));
    expect(up?.args.slice(-2)).toEqual(['agent', 'postgres']);
    expect(up?.env.POSTGRES_IMAGE).toBe(hubPostgres);
    expect(calls.find(isClaude)?.args).toEqual(
      expect.arrayContaining(['-e', `DATABASE_URL=${DATABASE_URL}`]),
    );
  });
});

describe('Docker check', () => {
  const planned = (runsDir: string) =>
    planRun({ task: '_template', condition: 'with', runs: 1, dryRun: false, publish: false }, ENV, {
      tasksDir: join(EVALS, 'tasks'),
      runsDir,
    });

  it.each([
    [{ code: 1, stderr: 'Cannot connect to the Docker daemon' }, 'Docker is not running'],
    [
      { stdout: 'windows\n' },
      'Docker runs windows containers; the eval image needs Linux containers',
    ],
  ])('refuses to run without a Linux Docker engine (%#)', async (reply, message) => {
    const runsDir = join(mkdtempSync(join(tmpdir(), 'theoldman-docker-')), 'runs');
    const { docker, calls } = fakeDocker((args) => (args[0] === 'version' ? reply : undefined));
    const run = planned(runsDir);
    await expect(
      executeRuns({ ...run, runDir: run.dir, env: ENV, paths: PATHS, docker }),
    ).rejects.toThrow(new ConfigError(message).message);
    expect(calls).toHaveLength(1);
    rmSync(join(runsDir, '..'), { recursive: true, force: true });
  });

  it('refuses when the docker binary is missing', async () => {
    const runsDir = join(mkdtempSync(join(tmpdir(), 'theoldman-docker-')), 'runs');
    const docker: DockerExec = () => Promise.reject(new Error('spawn docker ENOENT'));
    const run = planned(runsDir);
    await expect(
      executeRuns({ ...run, runDir: run.dir, env: ENV, paths: PATHS, docker }),
    ).rejects.toThrow('Docker is not installed or not on PATH');
    rmSync(join(runsDir, '..'), { recursive: true, force: true });
  });
});
