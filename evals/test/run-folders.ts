// Writes run folders shaped like the runner's (plan.json, <condition>-<n>/run.json and
// diff.patch) for the scorer tests.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TokenUsage } from '../src/claude.ts';
import { folderHash } from '../src/task.ts';

export const TASKS = fileURLToPath(new URL('../tasks/', import.meta.url));
export const DOCKER_DIR = fileURLToPath(new URL('../docker/', import.meta.url));
export const TEMPLATE_STARTER_HASH = folderHash(join(TASKS, '_template', 'starter'));

/** A diff that adds a narration comment and two code lines to the template's src/math.ts. */
export const CLAMP_DIFF = `diff --git a/src/math.ts b/src/math.ts
index 8d9b8a2..8eff0a8 100644
--- a/src/math.ts
+++ b/src/math.ts
@@ -1,3 +1,6 @@
 export function add(a: number, b: number): number {
   return a + b;
 }
+// Added clamp function
+export const clamp = (v: number, lo: number, hi: number): number =>
+  Math.min(Math.max(v, lo), hi);
`;

/** src/math.ts after CLAMP_DIFF. */
export const CLAMPED_MATH = `export function add(a: number, b: number): number {
  return a + b;
}
// Added clamp function
export const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(Math.max(v, lo), hi);
`;

export function plan(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    createdAt: '2026-11-27T10:00:00.000Z',
    task: {
      id: '_template',
      title: 'Template: add a clamp function',
      timeoutMinutes: 15,
      services: [],
      starterHash: TEMPLATE_STARTER_HASH,
    },
    condition: 'with',
    runs: 1,
    dryRun: false,
    publish: true,
    provider: { name: 'anthropic', auth: 'api-key', env: ['ANTHROPIC_API_KEY'] },
    models: {
      ANTHROPIC_MODEL: 'claude-sonnet-5-5',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-5-5',
    },
    claudeCode: '2.1.332',
    agentImage: 'theoldman-evals-agent:test',
    images: {},
    ...overrides,
  };
}

export function usage(outputTokens: number, costUSD = 0.1): TokenUsage {
  return {
    inputTokens: 10,
    outputTokens,
    cacheReadInputTokens: 1000,
    cacheCreationInputTokens: 100,
    costUSD,
  };
}

export function record(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    condition: 'with',
    run: 1,
    startedAt: '2026-11-27T10:00:05.000Z',
    wallTimeMs: 90_000,
    exitCode: 0,
    timedOut: false,
    interrupted: false,
    images: {},
    result: {
      isError: false,
      resultEvents: 1,
      durationMs: 80_000,
      numTurns: 6,
      totalCostUsd: 0.2,
      models: ['claude-sonnet-5-5'],
      modelUsage: { 'claude-sonnet-5-5': usage(5000, 0.2) },
      subagents: null,
      fields: { result: [], modelUsage: [] },
    },
    error: null,
    ...overrides,
  };
}

export interface FolderRunSpec {
  readonly record?: Record<string, unknown>;
  /** Null leaves diff.patch out, as when a run stopped before its diff. */
  readonly diff?: string | null;
}

export function writeRunFolder(
  root: string,
  name: string,
  planJson: Record<string, unknown>,
  runs: readonly FolderRunSpec[],
): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'plan.json'), JSON.stringify(planJson));
  runs.forEach((run, index) => {
    const condition = String(planJson.condition);
    const runDir = join(dir, `${condition}-${String(index + 1)}`);
    mkdirSync(runDir);
    writeFileSync(
      join(runDir, 'run.json'),
      JSON.stringify(record({ condition, run: index + 1, ...run.record })),
    );
    if (run.diff !== null) writeFileSync(join(runDir, 'diff.patch'), run.diff ?? CLAMP_DIFF);
  });
  return dir;
}
