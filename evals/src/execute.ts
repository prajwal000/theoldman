// Runs a planned task in Docker: per run a fresh Compose project with the starter copied in and
// committed as the baseline, Claude Code headless with the prompt, then the diff against the
// baseline. Each run saves transcript.jsonl, diff.patch, stderr.log and run.json, scrubbed of
// credentials, and its containers are removed whatever happens.

import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join, sep } from 'node:path';
import type { Condition } from './args.ts';
import { claudeArgs, parseResult, PLUGIN_DIR_IN_CONTAINER, type RunResult } from './claude.ts';
import { type DockerExec, type ExecOptions, must, pullFirst, requireDocker } from './docker.ts';
import { AGENT_IMAGE, CLAUDE_CODE_VERSION, IMAGES, imageRefs } from './images.ts';
import type { RunPlan } from './plan.ts';
import type { Env, Provider } from './provider.ts';
import { dockerEnv, scrub, secretValues } from './secrets.ts';
import type { Task } from './task.ts';

export interface RunRecord {
  readonly condition: Condition;
  readonly run: number;
  readonly startedAt: string;
  /** Time Claude Code ran, measured by the runner. */
  readonly wallTimeMs: number | null;
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  /** Pull references actually used, after any fallback to the mirror. */
  readonly images: Readonly<Record<string, string>>;
  readonly result: RunResult | null;
  readonly error: string | null;
}

export interface ExecuteContext {
  readonly plan: RunPlan;
  readonly task: Task;
  readonly provider: Provider;
  readonly env: Env;
  readonly runDir: string;
  readonly paths: { readonly dockerDir: string; readonly pluginDir: string };
  readonly docker: DockerExec;
  readonly clock?: () => number;
}

/** Inside the agent container; Postgres is reachable under its service name. */
export const DATABASE_URL = 'postgresql://eval:eval@postgres:5432/eval';

const GIT_IDENTITY = '-c user.name=theoldman-eval -c user.email=eval@theoldman.invalid';
const BASELINE = `git init -q && git add -A && git ${GIT_IDENTITY} commit -q --allow-empty -m baseline`;
// theoldman keeps its session state in .theoldman/; it is not part of what Claude changed.
const DIFF = `git add -A && git diff --cached --binary -- . ':(exclude).theoldman'`;

export async function executeRuns(ctx: ExecuteContext): Promise<RunRecord[]> {
  const env = dockerEnv(ctx.env, ctx.provider);
  const secrets = secretValues(ctx.env);
  await requireDocker(ctx.docker, env);
  const images = await prepareImages(ctx, env, secrets);
  const records: RunRecord[] = [];
  for (let run = 1; run <= ctx.plan.runs; run++) {
    records.push(await runOnce(ctx, run, images, env, secrets));
  }
  return records;
}

async function prepareImages(
  ctx: ExecuteContext,
  env: NodeJS.ProcessEnv,
  secrets: readonly string[],
): Promise<Record<string, string>> {
  const node = await pullFirst(ctx.docker, imageRefs(IMAGES.node), env);
  const { dockerDir } = ctx.paths;
  await must(
    ctx.docker,
    [
      'build',
      '-q',
      '-f',
      join(dockerDir, 'Dockerfile'),
      '--build-arg',
      `NODE_IMAGE=${node}`,
      '--build-arg',
      `CLAUDE_CODE_VERSION=${CLAUDE_CODE_VERSION}`,
      '-t',
      AGENT_IMAGE,
      dockerDir,
    ],
    { env, timeoutMs: 20 * 60_000 },
    secrets,
  );
  const images: Record<string, string> = { node };
  if (ctx.task.services.includes('postgres')) {
    images.postgres = await pullFirst(ctx.docker, imageRefs(IMAGES.postgres), env);
  }
  return images;
}

async function runOnce(
  ctx: ExecuteContext,
  run: number,
  images: Readonly<Record<string, string>>,
  env: NodeJS.ProcessEnv,
  secrets: readonly string[],
): Promise<RunRecord> {
  const { condition } = ctx.plan;
  const { task } = ctx;
  const clock = ctx.clock ?? Date.now;
  const name = `${condition}-${String(run)}`;
  const dir = join(ctx.runDir, name);
  mkdirSync(dir);
  const save = (file: string, text: string): void => {
    writeFileSync(join(dir, file), scrub(text, secrets));
  };

  // Compose project names allow lowercase letters, digits, "-" and "_".
  const project = `theoldman-eval-${basename(ctx.runDir)}-${name}`
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-');
  const composeEnv: NodeJS.ProcessEnv = { ...env, AGENT_IMAGE };
  if (images.postgres !== undefined) composeEnv.POSTGRES_IMAGE = images.postgres;
  const profiles = task.services.flatMap((service) => ['--profile', service]);
  const composeArgs = (args: readonly string[]): string[] => [
    'compose',
    '-p',
    project,
    '-f',
    join(ctx.paths.dockerDir, 'compose.yml'),
    ...profiles,
    ...args,
  ];
  const step = (args: readonly string[], options: Partial<ExecOptions> = {}) =>
    must(ctx.docker, composeArgs(args), { env: composeEnv, ...options }, secrets);

  const startedAt = new Date(clock()).toISOString();
  let record: RunRecord = {
    condition,
    run,
    startedAt,
    wallTimeMs: null,
    exitCode: null,
    timedOut: false,
    images,
    result: null,
    error: null,
  };
  try {
    await step(['up', '-d', '--wait', 'agent', ...task.services], { timeoutMs: 5 * 60_000 });
    await step(['cp', `${task.starterDir}${sep}.`, 'agent:/workspace']);
    if (condition === 'with') {
      await step(['cp', `${ctx.paths.pluginDir}${sep}.`, `agent:${PLUGIN_DIR_IN_CONTAINER}`]);
    }
    await step(['exec', '-T', '-u', 'root', 'agent', 'chown', '-R', 'node:node', '/workspace']);
    await step(['exec', '-T', 'agent', 'sh', '-c', BASELINE]);

    const dbEnv = task.services.includes('postgres') ? ['-e', `DATABASE_URL=${DATABASE_URL}`] : [];
    const start = clock();
    const claude = await ctx.docker(
      composeArgs(['exec', '-T', ...dbEnv, 'agent', ...claudeArgs(condition)]),
      { env: composeEnv, input: task.prompt, timeoutMs: task.timeoutMinutes * 60_000 },
    );
    const wallTimeMs = clock() - start;
    save('transcript.jsonl', claude.stdout);
    save('stderr.log', claude.stderr);
    const parsed = parseResult(claude.stdout);
    const result = 'error' in parsed ? null : parsed;
    let error: string | null = null;
    if (claude.timedOut)
      error = `Claude Code timed out after ${String(task.timeoutMinutes)} minutes`;
    else if ('error' in parsed) error = parsed.error;
    else if (claude.code !== 0) error = `Claude Code exited with ${String(claude.code)}`;
    record = {
      ...record,
      wallTimeMs,
      exitCode: claude.code,
      timedOut: claude.timedOut,
      result,
      error,
    };

    // After a timeout Claude may still be writing, so the diff would not be the final state.
    if (!claude.timedOut)
      save('diff.patch', (await step(['exec', '-T', 'agent', 'sh', '-c', DIFF])).stdout);
  } catch (error) {
    record = {
      ...record,
      error: scrub(error instanceof Error ? error.message : String(error), secrets),
    };
  } finally {
    await ctx.docker(composeArgs(['down', '-v', '--remove-orphans', '-t', '0']), {
      env: composeEnv,
      timeoutMs: 2 * 60_000,
    });
  }
  save('run.json', `${JSON.stringify(record, null, 2)}\n`);
  return record;
}
