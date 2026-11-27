// The results file: per task and condition, the mean and spread of every metric over the runs,
// with the exact models, provider and Claude Code version they ran on. It is validated against
// evals/schema/results.schema.json before it is written, and the schema rejects model aliases.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import type { Condition } from '../args.ts';
import { ConfigError } from '../errors.ts';
import type { ProviderAuth, ProviderName } from '../provider.ts';
import { type Stats, summarize } from './stats.ts';

export const METRICS = [
  'fillerComments',
  'fillerPer100Lines',
  'addedLines',
  'tscErrors',
  'eslintErrors',
  'inputTokens',
  'outputTokens',
  'cacheReadTokens',
  'cacheWriteTokens',
  'costUsd',
  'minutes',
] as const;
export type MetricName = (typeof METRICS)[number];

/** One scored run's values; a metric that could not be measured (no tsconfig, say) is absent. */
export type RunValues = Partial<Record<MetricName, number>>;

export interface ConditionResult {
  readonly runs: number;
  readonly failed: number;
  readonly runFolders: readonly string[];
  readonly metrics: Readonly<Record<MetricName, Stats | null>>;
}

export interface TaskResult {
  readonly id: string;
  readonly title: string;
  readonly conditions: Partial<Record<Condition, ConditionResult>>;
}

export interface Results {
  readonly schemaVersion: 1;
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
  readonly claudeCode: string;
  readonly notes: readonly string[];
  readonly tasks: readonly TaskResult[];
}

export const SCHEMA_FILE = fileURLToPath(
  new URL('../../schema/results.schema.json', import.meta.url),
);

/**
 * A short label for the results file name: `claude-sonnet-5-5` and
 * `us.anthropic.claude-sonnet-5-5-v1:0` both give `sonnet-5-5`, and a date suffix is dropped.
 */
export function modelLabel(id: string): string {
  const match =
    /^(?:[a-z-]+\.)?(?:anthropic\.)?claude-([a-z0-9-]+?)(?:-\d{8})?(?:-v\d+(?::\d+)?)?$/.exec(id);
  if (match?.[1] === undefined) {
    throw new ConfigError(
      `Cannot derive a results label from the model ID "${id}". Pin ANTHROPIC_MODEL to a model ID such as claude-sonnet-5-5.`,
    );
  }
  return match[1];
}

/** Mean and spread of each metric over a condition's scored runs. */
export function aggregate(
  runs: readonly RunValues[],
  failed: number,
  runFolders: readonly string[],
): ConditionResult {
  const metrics: Partial<Record<MetricName, Stats | null>> = {};
  for (const metric of METRICS) {
    metrics[metric] = summarize(
      runs.map((values) => values[metric]).filter((value) => value !== undefined),
    );
  }
  return { runs: runs.length, failed, runFolders, metrics: complete(metrics) };
}

function complete(
  metrics: Partial<Record<MetricName, Stats | null>>,
): Record<MetricName, Stats | null> {
  const get = (metric: MetricName): Stats | null => metrics[metric] ?? null;
  return {
    fillerComments: get('fillerComments'),
    fillerPer100Lines: get('fillerPer100Lines'),
    addedLines: get('addedLines'),
    tscErrors: get('tscErrors'),
    eslintErrors: get('eslintErrors'),
    inputTokens: get('inputTokens'),
    outputTokens: get('outputTokens'),
    cacheReadTokens: get('cacheReadTokens'),
    cacheWriteTokens: get('cacheWriteTokens'),
    costUsd: get('costUsd'),
    minutes: get('minutes'),
  };
}

let validator: ValidateFunction | undefined;

/** Throws a ConfigError naming every place the results do not match the schema. */
export function validateResults(value: unknown): void {
  if (validator === undefined) {
    const schema: unknown = JSON.parse(readFileSync(SCHEMA_FILE, 'utf8'));
    if (typeof schema !== 'object' || schema === null) {
      throw new ConfigError(`${SCHEMA_FILE} does not hold a JSON object.`);
    }
    validator = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  }
  if (validator(value)) return;
  const problems = (validator.errors ?? []).map(
    (error) =>
      `${error.instancePath === '' ? '(root)' : error.instancePath} ${error.message ?? ''}`,
  );
  throw new ConfigError(`The results do not match the schema:\n${problems.join('\n')}`);
}

/**
 * Validates and writes the results to <dir>/<date>-<label>.json, and returns the path. Results
 * that are not published get an `-unpublished` suffix, which git ignores, so a local or
 * subscription run cannot be committed as published results by mistake.
 */
export function writeResults(dir: string, results: Results): string {
  validateResults(results);
  mkdirSync(dir, { recursive: true });
  const suffix = results.published ? '' : '-unpublished';
  const file = join(dir, `${results.date}-${results.label}${suffix}.json`);
  writeFileSync(file, `${JSON.stringify(results, null, 2)}\n`);
  return file;
}
