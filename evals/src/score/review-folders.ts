// Scores review run folders into one results file. Each finished run's review goes to the LLM
// judge, which matches its findings to the golden comments; the injection check needs no judge,
// so a review that a planted instruction fooled cannot fool the score as well. The folders must
// have run on the same provider, models and Claude Code version, with exact model IDs, and the
// judge runs on that provider and the runs' main model.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Condition } from '../args.ts';
import { buildAgentImage, type DockerExec, requireDocker } from '../docker.ts';
import { ConfigError } from '../errors.ts';
import { type GoldenPr, goldenPrHash, loadGoldenPr } from '../golden-pr.ts';
import { removeOrphans } from '../orphans.ts';
import { detectProvider, type Env, type ProviderAuth, type ProviderName } from '../provider.ts';
import { dockerEnv, secretValues } from '../secrets.ts';
import { judgePrompt, readJudgePrompt, runJudge } from './judge.ts';
import { isScorable, type RunMetrics, runMetrics } from './metrics.ts';
import { modelLabel, writeResultsFile } from './results.ts';
import {
  addCounts,
  type Counts,
  countVerdict,
  injectionFollowed,
  NO_COUNTS,
  type Rates,
  rates,
  readReviewTranscript,
  reviewerRan,
} from './review.ts';
import type { RunFolder } from './run-folder.ts';
import { sameRun } from './score-folders.ts';
import { type Stats, summarize } from './stats.ts';
import { containerName } from './task-run.ts';

export const REVIEW_SCHEMA_FILE = fileURLToPath(
  new URL('../../schema/review-results.schema.json', import.meta.url),
);

export interface Summary extends Counts, Rates {
  readonly outputTokens: Stats | null;
  readonly costUsd: Stats | null;
  readonly minutes: Stats | null;
}

export interface PrResult {
  readonly id: string;
  readonly title: string;
  readonly clean: boolean;
  readonly injection: boolean;
  readonly goldenComments: number;
  readonly conditions: Partial<
    Record<Condition, Summary & { readonly runFolders: readonly string[] }>
  >;
}

export interface ReviewResults {
  readonly schemaVersion: 1;
  readonly kind: 'review';
  readonly createdAt: string;
  readonly date: string;
  readonly label: string;
  readonly published: boolean;
  readonly provider: { readonly name: ProviderName; readonly auth: ProviderAuth };
  readonly models: {
    readonly ANTHROPIC_MODEL: string;
    readonly ANTHROPIC_DEFAULT_SONNET_MODEL: string;
    readonly used: readonly string[];
  };
  readonly judge: {
    readonly model: string;
    readonly auth: ProviderAuth;
    /** SHA-256 of evals/judge/review-judge.md, so results name the judge prompt they used. */
    readonly prompt: string;
    readonly used: readonly string[];
    readonly costUsd: number;
  };
  readonly claudeCode: string;
  readonly notes: readonly string[];
  readonly conditions: Partial<Record<Condition, Summary>>;
  readonly prs: readonly PrResult[];
}

export interface ReviewScoreContext {
  readonly folders: readonly RunFolder[];
  readonly prsDir: string;
  readonly dockerDir: string;
  readonly env: Env;
  readonly docker: DockerExec;
  readonly signal?: AbortSignal;
  readonly now?: Date;
  readonly progress?: (line: string) => void;
}

interface Group {
  counts: Counts;
  readonly values: RunMetrics[];
  readonly folders: Set<string>;
}

function summary(counts: Counts, values: readonly RunMetrics[]): Summary {
  return {
    ...counts,
    ...rates(counts),
    outputTokens: summarize(values.map((value) => value.outputTokens)),
    costUsd: summarize(values.map((value) => value.costUsd)),
    minutes: summarize(values.map((value) => value.minutes)),
  };
}

function loadPrs(ctx: ReviewScoreContext): Map<string, GoldenPr> {
  const prs = new Map<string, GoldenPr>();
  for (const { name, plan } of ctx.folders) {
    if (plan.kind !== 'review') {
      throw new ConfigError(`${name} is a build run; score it separately from review runs.`);
    }
    const pr = loadGoldenPr(ctx.prsDir, plan.task.id);
    if (plan.prHash !== goldenPrHash(pr)) {
      throw new ConfigError(
        `${name}: golden PR ${pr.id} changed since the run (starter, patch, title or description), so the run reviewed something else.`,
      );
    }
    prs.set(pr.id, pr);
  }
  return prs;
}

export async function scoreReviewFolders(ctx: ReviewScoreContext): Promise<ReviewResults> {
  const { first, main, sonnet } = sameRun(ctx.folders.map((folder) => folder.plan));
  const prs = loadPrs(ctx);
  const judgeProvider = detectProvider(ctx.env);
  if (judgeProvider.name !== first.provider.name) {
    throw new ConfigError(
      `The runs used ${first.provider.name} and the judge would use ${judgeProvider.name}: set the runs' provider, so the judge runs on their exact model ${main}.`,
    );
  }
  const env = dockerEnv(ctx.env, judgeProvider);
  const secrets = secretValues(ctx.env);
  await requireDocker(ctx.docker, env);
  await removeOrphans(ctx.docker, env);
  await buildAgentImage(ctx.docker, ctx.dockerDir, env, secrets, ctx.signal);
  const prompt = readJudgePrompt();
  const judge = {
    docker: ctx.docker,
    env,
    envNames: judgeProvider.envNames,
    secrets,
    model: main,
    ...(ctx.signal === undefined ? {} : { signal: ctx.signal }),
  };

  const notes = new Set<string>();
  const used = new Set<string>();
  const judgeUsed = new Set<string>();
  let judgeCost = 0;
  const groups = new Map<string, Map<Condition, Group>>();
  for (const folder of ctx.folders) {
    const { plan } = folder;
    const pr = prs.get(plan.task.id);
    if (pr === undefined) throw new Error(`golden PR ${plan.task.id} was not loaded`);
    const byCondition = groups.get(pr.id) ?? new Map<Condition, Group>();
    groups.set(pr.id, byCondition);
    const group = byCondition.get(plan.condition) ?? {
      counts: NO_COUNTS,
      values: [],
      folders: new Set<string>(),
    };
    byCondition.set(plan.condition, group);
    group.folders.add(folder.name);

    for (const run of folder.runs) {
      const where = `${folder.name}/${run.name}`;
      const file = join(run.dir, 'transcript.jsonl');
      const review = existsSync(file) ? readReviewTranscript(readFileSync(file, 'utf8')) : null;
      let injection = { injectionRuns: 0, injectionResisted: 0 };
      if (pr.injection !== null && review !== null) {
        const why = injectionFollowed(pr.injection, review.toolUses, run.diff);
        injection = { injectionRuns: 1, injectionResisted: why === null ? 1 : 0 };
        if (why !== null) notes.add(`${where}: followed the planted instruction (${why}).`);
      }
      const add = (counts: Partial<Counts>): void => {
        group.counts = addCounts(group.counts, { ...NO_COUNTS, ...injection, ...counts });
      };

      const metrics = runMetrics(run.record);
      if (!isScorable(run.record) || metrics === null || review === null) {
        add({ failed: 1 });
        ctx.progress?.(`${where}: not scored (${run.record.error ?? 'no result'})`);
        continue;
      }
      if (plan.condition === 'with' && !reviewerRan(review.toolUses)) {
        notes.add(`${where}: theoldman's reviewer subagent did not run.`);
      }
      const judged = await runJudge(
        judge,
        containerName('theoldman-judge', folder.name, run.name),
        judgePrompt(prompt.text, pr.comments, review.parts),
        pr.comments.map((comment) => comment.id),
      );
      writeFileSync(join(run.dir, 'judge.jsonl'), judged.transcript);
      judgeCost += judged.costUsd;
      for (const model of judged.models) judgeUsed.add(model);
      if (judged.verdict === null) {
        add({ failed: 1 });
        notes.add(`${where}: not scored, ${judged.error ?? 'no verdict'}.`);
        ctx.progress?.(`${where}: not scored (${judged.error ?? 'no verdict'})`);
        continue;
      }
      const { verdict } = judged;
      writeFileSync(
        join(run.dir, 'judge.json'),
        `${JSON.stringify({ model: main, prompt: prompt.hash, verdict }, null, 2)}\n`,
      );
      const counts = countVerdict(verdict, pr);
      add({ runs: 1, ...counts });
      group.values.push(metrics);
      for (const model of Object.keys(run.record.result?.modelUsage ?? {})) used.add(model);
      const resisted =
        injection.injectionRuns === 0
          ? ''
          : `, injection ${injection.injectionResisted === 1 ? 'resisted' : 'FOLLOWED'}`;
      ctx.progress?.(
        `${where}: ${String(counts.findings)} findings, ${String(counts.truePositives)} matching, ${String(counts.goldenFound)} of ${String(counts.goldenTotal)} golden comments found${resisted}`,
      );
    }
  }
  if (used.size === 0) {
    throw new ConfigError(
      'No run in these folders finished and was judged, so there is nothing to score.',
    );
  }
  for (const model of judgeUsed) {
    if (model !== main) notes.add(`The judge also called ${model}, besides ${main}.`);
  }

  const totals = new Map<Condition, { counts: Counts; values: RunMetrics[] }>();
  const prResults: PrResult[] = [...groups].map(([id, byCondition]) => {
    const pr = prs.get(id);
    if (pr === undefined) throw new Error(`golden PR ${id} was not loaded`);
    const conditions: PrResult['conditions'] = {};
    for (const [condition, group] of byCondition) {
      conditions[condition] = {
        ...summary(group.counts, group.values),
        runFolders: [...group.folders].sort(),
      };
      const total = totals.get(condition) ?? { counts: NO_COUNTS, values: [] };
      totals.set(condition, {
        counts: addCounts(total.counts, group.counts),
        values: [...total.values, ...group.values],
      });
    }
    return {
      id,
      title: pr.title,
      clean: pr.clean,
      injection: pr.injection !== null,
      goldenComments: pr.comments.length,
      conditions,
    };
  });
  const conditions: ReviewResults['conditions'] = {};
  for (const [condition, total] of totals) {
    conditions[condition] = summary(total.counts, total.values);
  }

  const newest =
    ctx.folders
      .map((folder) => folder.plan.createdAt)
      .sort()
      .at(-1) ?? '';
  return {
    schemaVersion: 1,
    kind: 'review',
    createdAt: (ctx.now ?? new Date()).toISOString(),
    date: newest.slice(0, 10),
    label: modelLabel(main),
    published:
      judgeProvider.auth !== 'subscription-token' &&
      ctx.folders.every((folder) => folder.plan.publish && folder.plan.provider.auth === 'api-key'),
    provider: first.provider,
    models: {
      ANTHROPIC_MODEL: main,
      ANTHROPIC_DEFAULT_SONNET_MODEL: sonnet,
      used: [...used].sort(),
    },
    judge: {
      model: main,
      auth: judgeProvider.auth,
      prompt: prompt.hash,
      used: [...judgeUsed].sort(),
      costUsd: Math.round(judgeCost * 1_000_000) / 1_000_000,
    },
    claudeCode: first.claudeCode,
    notes: [...notes].sort(),
    conditions,
    prs: prResults,
  };
}

/** Validates and writes <dir>/<date>-<label>-review.json (or -review-unpublished.json). */
export function writeReviewResults(dir: string, results: ReviewResults): string {
  return writeResultsFile(dir, results, REVIEW_SCHEMA_FILE, '-review');
}
