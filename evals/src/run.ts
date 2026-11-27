// Command-line entry: pnpm --filter evals run eval --task <id> --condition with|without ...
// Problems with the input are printed as one message with exit code 1; anything else is a bug and
// keeps its stack trace.

import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRunArgs, USAGE } from './args.ts';
import { dockerExec, InterruptedError } from './docker.ts';
import { ConfigError } from './errors.ts';
import { executeRuns, type RunRecord } from './execute.ts';
import { PLAN_FILE, planRun } from './plan.ts';

const evalsDir = fileURLToPath(new URL('..', import.meta.url));
const repoDir = join(evalsDir, '..');

function summarize(record: RunRecord): string {
  const label = `${record.condition} #${String(record.run)}`;
  const { result } = record;
  if (result === null) return `${label}: failed: ${record.error ?? 'no result'}`;
  const output = Object.values(result.modelUsage).reduce((sum, u) => sum + u.outputTokens, 0);
  const seconds = Math.round((record.wallTimeMs ?? result.durationMs) / 1000);
  const status = record.error === null ? (result.isError ? 'error' : 'ok') : record.error;
  const models = result.models.length === 0 ? 'no model calls' : result.models.join(', ');
  return `${label}: ${status}, ${String(seconds)} s, ${String(result.numTurns)} turns, $${result.totalCostUsd.toFixed(3)}, ${String(output)} output tokens (${models})`;
}

async function main(): Promise<void> {
  const args = parseRunArgs(process.argv.slice(2));
  if (args === undefined) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  const planned = planRun(args, process.env, {
    tasksDir: join(evalsDir, 'tasks'),
    runsDir: join(evalsDir, 'runs'),
  });
  const { plan, dir } = planned;
  const runs = `${String(plan.runs)} run${plan.runs === 1 ? '' : 's'}`;
  const what = `task ${plan.task.id}, condition ${plan.condition}, ${runs}, provider ${plan.provider.name}`;
  if (plan.dryRun) {
    process.stdout.write(
      `Dry run: ${what}.\nPlanned run written to ${relative(repoDir, join(dir, PLAN_FILE))}\n`,
    );
    return;
  }
  process.stdout.write(`Running ${what} in Docker.\n`);
  // Ctrl+C would otherwise end the runner at once and leave the run's containers behind.
  const controller = new AbortController();
  const interrupt = (): void => {
    if (controller.signal.aborted) process.exit(INTERRUPTED_EXIT);
    process.stderr.write(
      '\nInterrupted: stopping the run and removing its containers. Press Ctrl+C again to quit at once.\n',
    );
    controller.abort();
  };
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  const records = await executeRuns({
    ...planned,
    runDir: dir,
    env: process.env,
    paths: { dockerDir: join(evalsDir, 'docker'), pluginDir: join(repoDir, 'plugin') },
    docker: dockerExec,
    signal: controller.signal,
  });
  for (const record of records) process.stdout.write(`${summarize(record)}\n`);
  process.stdout.write(`Saved to ${relative(repoDir, dir)}\n`);
  if (controller.signal.aborted) process.exitCode = INTERRUPTED_EXIT;
  else if (records.some((record) => record.error !== null || record.result?.isError !== false)) {
    process.exitCode = 1;
  }
}

// The usual exit code after Ctrl+C (128 + SIGINT).
const INTERRUPTED_EXIT = 130;

try {
  await main();
} catch (error) {
  if (error instanceof InterruptedError) {
    process.stderr.write('eval: interrupted before any run started.\n');
    process.exitCode = INTERRUPTED_EXIT;
  } else if (error instanceof ConfigError) {
    process.stderr.write(`eval: ${error.message}\n`);
    process.exitCode = 1;
  } else {
    throw error;
  }
}
