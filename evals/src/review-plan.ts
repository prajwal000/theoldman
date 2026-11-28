// The review runner's arguments and plan, and the steps that turn a run's container into the
// golden PR: the starter committed on main, then the PR's patch committed on its own branch.
// Claude then reviews that branch: with theoldman's review command, or asked in plain words.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { type Condition, MAX_RUNS, DEFAULT_RUNS, parseRuns } from './args.ts';
import { ConfigError } from './errors.ts';
import type { ComposeStep, RunnableTask } from './execute.ts';
import {
  commitMessage,
  type GoldenPr,
  goldenPrHash,
  loadGoldenPr,
  loadReviewPrompt,
} from './golden-pr.ts';
import { AGENT_IMAGE, CLAUDE_CODE_VERSION, IMAGES, imageRefs } from './images.ts';
import { newRunDir, PLAN_FILE, planProvider, type RunPlan } from './plan.ts';
import type { Env, Provider } from './provider.ts';
import { starterHash } from './task.ts';

export interface ReviewArgs {
  readonly pr: string;
  readonly condition: Condition;
  readonly runs: number;
  readonly dryRun: boolean;
  readonly publish: boolean;
}

export const REVIEW_USAGE = `Usage: pnpm --filter evals run review --pr <id> --condition with|without [--runs <n>] [--dry-run] [--publish]

  --pr         golden PR folder under evals/golden-prs/
  --condition  with: theoldman loaded; without: no plugin
  --runs       runs per condition, 1 to ${String(MAX_RUNS)} (default ${String(DEFAULT_RUNS)})
  --dry-run    validate everything and write the planned run, without running Claude
  --publish    mark the run for publication: model variables must be exact model IDs`;

/** Long enough for theoldman's reviewer and verifier on a small PR, with room to spare. */
export const REVIEW_TIMEOUT_MINUTES = 20;

/** Parses the review runner's arguments; `undefined` means `--help` was asked for. */
export function parseReviewArgs(argv: readonly string[]): ReviewArgs | undefined {
  const args = argv[0] === '--' ? argv.slice(1) : [...argv];
  let values;
  try {
    ({ values } = parseArgs({
      args,
      strict: true,
      allowPositionals: false,
      options: {
        pr: { type: 'string' },
        condition: { type: 'string' },
        runs: { type: 'string' },
        'dry-run': { type: 'boolean', default: false },
        publish: { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
      },
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ConfigError(`${message}\n\n${REVIEW_USAGE}`);
  }
  if (values.help) return undefined;
  const { pr, condition } = values;
  if (pr === undefined) throw new ConfigError(`--pr is required.\n\n${REVIEW_USAGE}`);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(pr)) {
    throw new ConfigError(
      `--pr "${pr}" is not a golden PR ID: use lowercase letters, digits and "-".`,
    );
  }
  if (condition !== 'with' && condition !== 'without') {
    throw new ConfigError(`--condition must be "with" or "without".\n\n${REVIEW_USAGE}`);
  }
  return {
    pr,
    condition,
    runs: parseRuns(values.runs),
    dryRun: values['dry-run'],
    publish: values.publish,
  };
}

/** A build run's plan, with the golden PR in place of the task. */
export interface ReviewPlan extends Omit<RunPlan, 'task'> {
  readonly kind: 'review';
  readonly task: {
    readonly id: string;
    readonly title: string;
    readonly timeoutMinutes: number;
    readonly services: readonly [];
    readonly starterHash: string;
  };
  readonly pr: {
    readonly branch: string;
    /** The starter, patch and commit message the run reviewed; scoring refuses a change. */
    readonly hash: string;
  };
}

export interface PlannedReview {
  readonly dir: string;
  readonly plan: ReviewPlan;
  readonly pr: GoldenPr;
  readonly task: RunnableTask;
  readonly provider: Provider;
}

export function planReview(
  args: ReviewArgs,
  env: Env,
  dirs: { readonly prsDir: string; readonly runsDir: string },
  now: Date = new Date(),
): PlannedReview {
  const pr = loadGoldenPr(dirs.prsDir, args.pr);
  const prompt = loadReviewPrompt(dirs.prsDir, args.condition);
  const { provider, models } = planProvider(args.publish, env);
  const plan: ReviewPlan = {
    kind: 'review',
    createdAt: now.toISOString(),
    task: {
      id: pr.id,
      title: pr.title,
      timeoutMinutes: REVIEW_TIMEOUT_MINUTES,
      services: [],
      starterHash: starterHash(pr.starterDirs),
    },
    pr: { branch: pr.branch, hash: goldenPrHash(pr) },
    condition: args.condition,
    runs: args.runs,
    dryRun: args.dryRun,
    publish: args.publish,
    provider: { name: provider.name, auth: provider.auth, env: provider.envNames },
    models,
    claudeCode: CLAUDE_CODE_VERSION,
    agentImage: AGENT_IMAGE,
    images: { node: imageRefs(IMAGES.node) },
  };
  const dir = newRunDir(dirs.runsDir, `review-${plan.createdAt.replace(/[:.]/g, '-')}`);
  writeFileSync(join(dir, PLAN_FILE), `${JSON.stringify(plan, null, 2)}\n`);
  const task: RunnableTask = {
    prompt,
    starterDirs: pr.starterDirs,
    services: [],
    timeoutMinutes: REVIEW_TIMEOUT_MINUTES,
  };
  return { dir, plan, pr, task, provider };
}

const GIT_IDENTITY = ['-c', 'user.name=theoldman-eval', '-c', 'user.email=eval@theoldman.invalid'];

/**
 * Commits the PR on its branch after the runner's baseline commit. The patch and the commit
 * message go in on stdin, never on a command line, since a PR's text may be hostile.
 */
export function prSetup(pr: GoldenPr): (step: ComposeStep) => Promise<void> {
  return async (step) => {
    const git = (args: readonly string[], input?: string) =>
      step(['exec', '-T', 'agent', 'git', ...args], input === undefined ? {} : { input });
    await git(['branch', '-M', 'main']);
    await git(['checkout', '-q', '-b', pr.branch]);
    await git(['apply', '--index', '--whitespace=nowarn', '-'], pr.patch);
    await git([...GIT_IDENTITY, 'commit', '-q', '-F', '-'], commitMessage(pr));
  };
}
