// Command-line entry: pnpm --filter evals run eval --task <id> --condition with|without ...
// Problems with the input are printed as one message with exit code 1; anything else is a bug and
// keeps its stack trace.

import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRunArgs, USAGE } from './args.ts';
import { dockerExec, InterruptedError } from './docker.ts';
import { ConfigError } from './errors.ts';
import { anyFailed, executeRuns, summarize } from './execute.ts';
import { abortOnInterrupt, INTERRUPTED_EXIT } from './interrupt.ts';
import { PLAN_FILE, planRun } from './plan.ts';

const evalsDir = fileURLToPath(new URL('..', import.meta.url));
const repoDir = join(evalsDir, '..');

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
  const controller = abortOnInterrupt();
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
  else if (anyFailed(records)) process.exitCode = 1;
}

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
