// Command-line entry: pnpm --filter evals run score -- <run folder>...
// Scores finished run folders into evals/results/<date>-<label>.json, or review runs into
// <date>-<label>-review.json. Run with the resolve hook
// in ts-imports.ts, which the package script loads, so the comment rules come from
// packages/hooks/src.

import { existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dockerExec, InterruptedError } from './docker.ts';
import { ConfigError } from './errors.ts';
import { abortOnInterrupt, INTERRUPTED_EXIT } from './interrupt.ts';
import { type ConditionResult, writeResults } from './score/results.ts';
import { scoreReviewFolders, type Summary, writeReviewResults } from './score/review-folders.ts';
import { readRunFolder, type RunFolder } from './score/run-folder.ts';
import { scoreFolders } from './score/score-folders.ts';

const evalsDir = fileURLToPath(new URL('..', import.meta.url));
const repoDir = join(evalsDir, '..');
const runsDir = join(evalsDir, 'runs');

const USAGE = `Usage: pnpm --filter evals run score -- <run folder>...

  <run folder>  a folder the runner wrote, by name (as in evals/runs/) or path

Scores every run in the folders and writes evals/results/<date>-<label>.json, or
<date>-<label>-review.json for review runs, whose reviews an LLM judge compares with the golden
comments on the runs' provider and main model. The folders must have run on the same provider,
models and Claude Code version, with exact model IDs, and be all build runs or all review runs.`;

function folderPath(arg: string): string {
  const candidates = [join(runsDir, arg), resolve(process.env.INIT_CWD ?? process.cwd(), arg)];
  const found = candidates.find((path) => existsSync(join(path, 'plan.json')));
  if (found === undefined)
    throw new ConfigError(`No run folder "${arg}" in evals/runs/ or at that path.`);
  return found;
}

const mean = (stats: ConditionResult['metrics'][keyof ConditionResult['metrics']]): string =>
  stats === null ? '-' : String(Math.round(stats.mean * 100) / 100);

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((arg) => arg !== '--');
  if (args.length === 0 || args.includes('--help')) {
    process.stdout.write(`${USAGE}\n`);
    if (args.length === 0) process.exitCode = 1;
    return;
  }
  const folders = args.map((arg) => readRunFolder(folderPath(arg)));
  const reviews = folders.filter((folder) => folder.plan.kind === 'review').length;
  if (reviews > 0 && reviews < folders.length) {
    throw new ConfigError('Score build runs and review runs separately.');
  }
  if (reviews > 0) {
    await scoreReviews(folders);
    return;
  }
  const controller = abortOnInterrupt();
  const results = await scoreFolders({
    folders,
    tasksDir: join(evalsDir, 'tasks'),
    dockerDir: join(evalsDir, 'docker'),
    env: process.env,
    docker: dockerExec,
    signal: controller.signal,
    progress: (line) => process.stdout.write(`${line}\n`),
  });
  const file = writeResults(join(evalsDir, 'results'), results);
  for (const task of results.tasks) {
    for (const [condition, result] of Object.entries(task.conditions)) {
      const { metrics } = result;
      process.stdout.write(
        `${task.id} ${condition}: ${String(result.runs)} runs (${String(result.failed)} failed), filler ${mean(metrics.fillerComments)}, tsc ${mean(metrics.tscErrors)}, eslint ${mean(metrics.eslintErrors)}, build failed ${mean(metrics.buildFailed)}, semgrep ${mean(metrics.semgrepFindings)}, gitleaks ${mean(metrics.gitleaksFindings)}, hidden tests ${mean(metrics.hiddenTestsPassRate)}, tests added ${mean(metrics.testsAdded)}, docs in sync ${mean(metrics.docsInSync)}, output tokens ${mean(metrics.outputTokens)}, $${mean(metrics.costUsd)}, ${mean(metrics.minutes)} min\n`,
      );
    }
  }
  for (const note of results.notes) process.stdout.write(`note: ${note}\n`);
  process.stdout.write(`Results written to ${relative(repoDir, file)}\n`);
}

const rate = (value: number | null): string =>
  value === null ? '-' : `${String(Math.round(value * 1000) / 10)}%`;

function reviewLine(name: string, s: Summary): string {
  return `${name}: ${String(s.runs)} runs (${String(s.failed)} failed), precision ${rate(s.precision)} (${String(s.truePositives)}/${String(s.findings)}), recall ${rate(s.recall)} (${String(s.goldenFound)}/${String(s.goldenTotal)}), injection pass rate ${rate(s.injectionPassRate)} (${String(s.injectionResisted)}/${String(s.injectionRuns)}), $${mean(s.costUsd)}, ${mean(s.minutes)} min`;
}

async function scoreReviews(folders: readonly RunFolder[]): Promise<void> {
  const controller = abortOnInterrupt();
  const results = await scoreReviewFolders({
    folders,
    prsDir: join(evalsDir, 'golden-prs'),
    dockerDir: join(evalsDir, 'docker'),
    env: process.env,
    docker: dockerExec,
    signal: controller.signal,
    progress: (line) => process.stdout.write(`${line}\n`),
  });
  const file = writeReviewResults(join(evalsDir, 'results'), results);
  for (const pr of results.prs) {
    for (const [condition, summary] of Object.entries(pr.conditions)) {
      process.stdout.write(`${reviewLine(`${pr.id} ${condition}`, summary)}\n`);
    }
  }
  for (const [condition, summary] of Object.entries(results.conditions)) {
    process.stdout.write(`${reviewLine(`all ${condition}`, summary)}\n`);
  }
  for (const note of results.notes) process.stdout.write(`note: ${note}\n`);
  process.stdout.write(`Judge: ${results.judge.model}, $${String(results.judge.costUsd)}\n`);
  process.stdout.write(`Results written to ${relative(repoDir, file)}\n`);
}

try {
  await main();
} catch (error) {
  if (error instanceof InterruptedError) {
    process.stderr.write('score: interrupted.\n');
    process.exitCode = INTERRUPTED_EXIT;
  } else if (error instanceof ConfigError) {
    process.stderr.write(`score: ${error.message}\n`);
    process.exitCode = 1;
  } else {
    throw error;
  }
}
