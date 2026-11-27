// The Claude Code command line for one run, and the parser for the result event at the end of its
// stream-json output. Both arms use the same flags; "with" only adds the plugin.

import type { Condition } from './args.ts';

/** Where the runner copies theoldman's plugin folder in the agent container. */
export const PLUGIN_DIR_IN_CONTAINER = '/opt/theoldman/plugin';

/**
 * Arguments that start Claude Code in the agent container. They skip every permission prompt,
 * which is only acceptable because the container is the sandbox: the runner passes them to
 * `docker compose exec` and nowhere else. Never `--bare`, which skips plugin hooks.
 */
export function claudeArgs(condition: Condition): string[] {
  const args = [
    'claude',
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--permission-mode',
    'bypassPermissions',
  ];
  return condition === 'with' ? [...args, '--plugin-dir', PLUGIN_DIR_IN_CONTAINER] : args;
}

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadInputTokens: number;
  readonly cacheCreationInputTokens: number;
  readonly costUSD: number;
}

export interface RunResult {
  /** True if any result event reports an error. */
  readonly isError: boolean;
  /**
   * Claude Code ends a session with one result event per turn it finishes, including turns that
   * only take in a background subagent's report. `duration_ms` and `num_turns` count one event,
   * so these sum them; the cost and token totals are cumulative and come from the last event.
   */
  readonly resultEvents: number;
  readonly durationMs: number;
  readonly numTurns: number;
  readonly totalCostUsd: number;
  /** Exact model IDs that ran, main agent and subagents, from the `modelUsage` keys. */
  readonly models: readonly string[];
  /** Includes subagent calls, unlike the result's `usage`. */
  readonly modelUsage: Readonly<Record<string, TokenUsage>>;
  readonly subagents: { readonly spawned: number; readonly byType: Record<string, number> } | null;
  /** Field names seen, so a change in Claude Code's output shows up in the saved run. */
  readonly fields: { readonly result: readonly string[]; readonly modelUsage: readonly string[] };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

class ShapeError extends Error {}

function count(record: Record<string, unknown>, key: string, label: string): number {
  const value = record[key];
  if (!isCount(value)) throw new ShapeError(`result event: ${label} is not a number`);
  return value;
}

/** Parses the result events of a stream-json transcript, or explains why it cannot. */
export function parseResult(transcript: string): RunResult | { readonly error: string } {
  const events = resultEvents(transcript);
  if (events.length === 0) return { error: 'the transcript has no result event' };
  try {
    return readResults(events);
  } catch (error) {
    if (error instanceof ShapeError) return { error: error.message };
    throw error;
  }
}

function readResults(events: readonly Record<string, unknown>[]): RunResult {
  let isError = false;
  let durationMs = 0;
  let numTurns = 0;
  let cost = 0;
  for (const event of events) {
    if (typeof event.is_error !== 'boolean') {
      throw new ShapeError('result event: is_error is not a boolean');
    }
    isError ||= event.is_error;
    durationMs += count(event, 'duration_ms', 'duration_ms');
    numTurns += count(event, 'num_turns', 'num_turns');
    const total = count(event, 'total_cost_usd', 'total_cost_usd');
    // The last event's totals stand for the whole run only if they never go down.
    if (total < cost) throw new ShapeError('result events: total_cost_usd went down');
    cost = total;
  }

  const event = events.at(-1) ?? {};
  const { modelUsage } = event;
  if (!isRecord(modelUsage)) throw new ShapeError('result event: modelUsage is not an object');

  const usage: Record<string, TokenUsage> = {};
  const usageFields = new Set<string>();
  for (const [model, entry] of Object.entries(modelUsage)) {
    if (!isRecord(entry))
      throw new ShapeError(`result event: modelUsage.${model} is not an object`);
    for (const key of Object.keys(entry)) usageFields.add(key);
    const field = (key: string): number => count(entry, key, `modelUsage.${model}.${key}`);
    usage[model] = {
      inputTokens: field('inputTokens'),
      outputTokens: field('outputTokens'),
      cacheReadInputTokens: field('cacheReadInputTokens'),
      cacheCreationInputTokens: field('cacheCreationInputTokens'),
      costUSD: field('costUSD'),
    };
  }

  return {
    isError,
    resultEvents: events.length,
    durationMs,
    numTurns,
    totalCostUsd: cost,
    models: Object.keys(usage).sort(),
    modelUsage: usage,
    subagents: parseSubagents(event.subagent_stats),
    fields: { result: Object.keys(event).sort(), modelUsage: [...usageFields].sort() },
  };
}

function resultEvents(transcript: string): Record<string, unknown>[] {
  const events: Record<string, unknown>[] = [];
  for (const raw of transcript.split('\n')) {
    const line = raw.trim();
    if (line === '') continue;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      // A truncated or non-JSON line (a crash message) is not a result; keep looking.
      continue;
    }
    if (isRecord(event) && event.type === 'result') events.push(event);
  }
  return events;
}

function parseSubagents(stats: unknown): RunResult['subagents'] {
  if (!isRecord(stats) || !isCount(stats.spawned)) return null;
  const byType: Record<string, number> = {};
  if (isRecord(stats.by_type)) {
    for (const [type, count] of Object.entries(stats.by_type)) {
      if (isCount(count)) byType[type] = count;
    }
  }
  return { spawned: stats.spawned, byType };
}
