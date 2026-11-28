// Reads a run folder the runner wrote: plan.json plus one <condition>-<n>/ folder per run with
// run.json and, when the run got that far, diff.patch and transcript.jsonl (for Claude's final
// message). The files are checked for the fields the
// scorers use, since a folder may come from an older runner or be edited by hand.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { Condition } from '../args.ts';
import type { TokenUsage } from '../claude.ts';
import { ConfigError } from '../errors.ts';
import type { ProviderAuth, ProviderName } from '../provider.ts';

export interface FolderPlan {
  /** A build task run, or a review of a golden PR (whose ID is then the task ID). */
  readonly kind: 'build' | 'review';
  /** For a review: the golden PR's hash when it ran. */
  readonly prHash: string | null;
  readonly createdAt: string;
  readonly task: {
    readonly id: string;
    readonly title: string;
    readonly starterHash: string | null;
  };
  readonly condition: Condition;
  readonly publish: boolean;
  readonly provider: { readonly name: ProviderName; readonly auth: ProviderAuth };
  readonly models: {
    readonly ANTHROPIC_MODEL: string | null;
    readonly ANTHROPIC_DEFAULT_SONNET_MODEL: string | null;
  };
  readonly claudeCode: string;
}

/** The parts of a run.json the scorers read. A RunRecord has this shape. */
export interface ScoringRecord {
  readonly run: number;
  readonly wallTimeMs: number | null;
  readonly error: string | null;
  readonly result: {
    readonly isError: boolean;
    readonly totalCostUsd: number;
    readonly durationMs: number;
    readonly modelUsage: Readonly<Record<string, TokenUsage>>;
  } | null;
}

export interface FolderRun {
  readonly name: string;
  readonly dir: string;
  readonly record: ScoringRecord;
  /** Null when the run stopped before its diff was taken. */
  readonly diff: string | null;
  /** Claude's final message, from the last result event in the transcript; '' if none. */
  readonly summary: string;
}

export interface RunFolder {
  readonly name: string;
  readonly dir: string;
  readonly plan: FolderPlan;
  readonly runs: readonly FolderRun[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string' && value !== '';
const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const orNull = (value: unknown): string | null => (typeof value === 'string' ? value : null);

function readJson(file: string, label: string): Record<string, unknown> {
  if (!existsSync(file)) throw new ConfigError(`${label} is missing.`);
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    throw new ConfigError(`${label} is not valid JSON.`);
  }
  if (!isRecord(value)) throw new ConfigError(`${label} must hold a JSON object.`);
  return value;
}

function readPlan(dir: string, name: string): FolderPlan {
  const plan = readJson(join(dir, 'plan.json'), `${name}/plan.json`);
  const bad = (field: string): never => {
    throw new ConfigError(`${name}/plan.json: ${field} is missing or malformed.`);
  };
  const { createdAt, task, condition, dryRun, publish, provider, models, claudeCode } = plan;
  if (!isText(createdAt)) return bad('createdAt');
  if (!isRecord(task) || !isText(task.id) || !isText(task.title)) return bad('task');
  if (condition !== 'with' && condition !== 'without') return bad('condition');
  if (dryRun !== false) {
    throw new ConfigError(`${name} is a dry run: there is nothing to score.`);
  }
  if (typeof publish !== 'boolean') return bad('publish');
  if (
    !isRecord(provider) ||
    (provider.name !== 'anthropic' && provider.name !== 'bedrock') ||
    (provider.auth !== 'api-key' &&
      provider.auth !== 'subscription-token' &&
      provider.auth !== 'aws')
  ) {
    return bad('provider');
  }
  if (!isRecord(models)) return bad('models');
  if (!isText(claudeCode)) return bad('claudeCode');
  const pr = isRecord(plan.pr) ? plan.pr : {};
  return {
    kind: plan.kind === 'review' ? 'review' : 'build',
    prHash: orNull(pr.hash),
    createdAt,
    task: { id: task.id, title: task.title, starterHash: orNull(task.starterHash) },
    condition,
    publish,
    provider: { name: provider.name, auth: provider.auth },
    models: {
      ANTHROPIC_MODEL: orNull(models.ANTHROPIC_MODEL),
      ANTHROPIC_DEFAULT_SONNET_MODEL: orNull(models.ANTHROPIC_DEFAULT_SONNET_MODEL),
    },
    claudeCode,
  };
}

function readUsage(value: unknown): Record<string, TokenUsage> | undefined {
  if (!isRecord(value)) return undefined;
  const usage: Record<string, TokenUsage> = {};
  for (const [model, entry] of Object.entries(value)) {
    if (!isRecord(entry)) return undefined;
    const { inputTokens, outputTokens, cacheReadInputTokens, cacheCreationInputTokens, costUSD } =
      entry;
    if (
      !isNumber(inputTokens) ||
      !isNumber(outputTokens) ||
      !isNumber(cacheReadInputTokens) ||
      !isNumber(cacheCreationInputTokens) ||
      !isNumber(costUSD)
    ) {
      return undefined;
    }
    usage[model] = {
      inputTokens,
      outputTokens,
      cacheReadInputTokens,
      cacheCreationInputTokens,
      costUSD,
    };
  }
  return usage;
}

function readRecord(file: string, label: string): ScoringRecord {
  const { run, wallTimeMs, error, result } = readJson(file, label);
  const bad = (): never => {
    throw new ConfigError(`${label} is missing fields the scorers need.`);
  };
  if (!isNumber(run) || !(wallTimeMs === null || isNumber(wallTimeMs))) return bad();
  if (!(error === null || typeof error === 'string')) return bad();
  if (result === null) return { run, wallTimeMs, error, result: null };
  if (!isRecord(result)) return bad();
  const { isError, totalCostUsd, durationMs } = result;
  const modelUsage = readUsage(result.modelUsage);
  if (typeof isError !== 'boolean' || !isNumber(totalCostUsd) || !isNumber(durationMs)) {
    return bad();
  }
  if (modelUsage === undefined) return bad();
  return { run, wallTimeMs, error, result: { isError, totalCostUsd, durationMs, modelUsage } };
}

function readSummary(file: string): string {
  if (!existsSync(file)) return '';
  let summary = '';
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.startsWith('{')) continue;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      // A truncated line (the run was stopped mid-write) holds no result.
      continue;
    }
    if (isRecord(event) && event.type === 'result' && typeof event.result === 'string') {
      summary = event.result;
    }
  }
  return summary;
}

export function readRunFolder(dir: string): RunFolder {
  const name = basename(dir);
  if (!existsSync(dir)) throw new ConfigError(`Run folder ${dir} does not exist.`);
  const plan = readPlan(dir, name);
  const runs = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^(?:with|without)-\d+$/.test(entry.name))
    .map((entry) => {
      const runDir = join(dir, entry.name);
      const diffFile = join(runDir, 'diff.patch');
      return {
        name: entry.name,
        dir: runDir,
        record: readRecord(join(runDir, 'run.json'), `${name}/${entry.name}/run.json`),
        diff: existsSync(diffFile) ? readFileSync(diffFile, 'utf8') : null,
        summary: readSummary(join(runDir, 'transcript.jsonl')),
      };
    })
    .sort((a, b) => a.record.run - b.record.run);
  if (runs.length === 0) throw new ConfigError(`${name} has no runs.`);
  return { name, dir, plan, runs };
}
