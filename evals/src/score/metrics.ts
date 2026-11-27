// Token, cost and time metrics of one run, from its run.json. `modelUsage` includes subagent
// calls, so theoldman's reviewer and verifier count towards the "with" arm.

import type { ScoringRecord } from './run-folder.ts';

export interface RunMetrics {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly costUsd: number;
  readonly minutes: number;
}

/** A run counts only if Claude Code finished it without an error. */
export function isScorable(record: ScoringRecord): boolean {
  return record.error === null && record.result !== null && !record.result.isError;
}

export function runMetrics(record: ScoringRecord): RunMetrics | null {
  const { result } = record;
  if (result === null || !isScorable(record)) return null;
  const usage = Object.values(result.modelUsage);
  const sum = (pick: (entry: (typeof usage)[number]) => number): number =>
    usage.reduce((total, entry) => total + pick(entry), 0);
  return {
    inputTokens: sum((entry) => entry.inputTokens),
    outputTokens: sum((entry) => entry.outputTokens),
    cacheReadTokens: sum((entry) => entry.cacheReadInputTokens),
    cacheWriteTokens: sum((entry) => entry.cacheCreationInputTokens),
    costUsd: result.totalCostUsd,
    // The runner's own clock; the result events' durations leave out container start-up.
    minutes: (record.wallTimeMs ?? result.durationMs) / 60_000,
  };
}
