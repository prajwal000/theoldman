// Command-line entry: pnpm --filter evals run review --pr <id> --condition with|without ...
// Runs Claude Code in Docker on a golden PR's branch with the review prompt, with or without
// theoldman, and saves each run like a build run. `score` then judges the reviews.

import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dockerExec, InterruptedError } from './docker.ts';
import { ConfigError } from './errors.ts';
import { anyFailed, executeRuns, summarize } from './execute.ts';
import { abortOnInterrupt, INTERRUPTED_EXIT } from './interrupt.ts';
import { PLAN_FILE } from './plan.ts';
import { parseReviewArgs, planReview, prSetup, REVIEW_USAGE } from './review-plan.ts';

const evalsDir = fileURLToPath(new URL('..', import.meta.url));
const repoDir = join(evalsDir, '..');

async function main(): Promise<void> {
  const args = parseReviewArgs(process.argv.slice(2));
  if (args === undefined) {
    process.stdout.write(`${REVIEW_USAGE}\n`);
    return;
  }
  const planned = planReview(args, process.env, {
    prsDir: join(evalsDir, 'golden-prs'),
    runsDir: join(evalsDir, 'runs'),
  });
  const { plan, dir } = planned;
  const runs = `${String(plan.runs)} run${plan.runs === 1 ? '' : 's'}`;
  const what = `golden PR ${plan.task.id}, condition ${plan.condition}, ${runs}, provider ${plan.provider.name}`;
  if (plan.dryRun) {
    process.stdout.write(
      `Dry run: ${what}.\nPlanned run written to ${relative(repoDir, join(dir, PLAN_FILE))}\n`,
    );
    return;
  }
  process.stdout.write(`Reviewing ${what} in Docker.\n`);
  const controller = abortOnInterrupt();
  const records = await executeRuns({
    plan,
    task: planned.task,
    provider: planned.provider,
    setup: prSetup(planned.pr),
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
    process.stderr.write('review: interrupted before any run started.\n');
    process.exitCode = INTERRUPTED_EXIT;
  } else if (error instanceof ConfigError) {
    process.stderr.write(`review: ${error.message}\n`);
    process.exitCode = 1;
  } else {
    throw error;
  }
}
