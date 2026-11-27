import { describe, expect, it } from 'vitest';
import { scoreComments } from '../src/score/comments.ts';
import { isScorable, runMetrics } from '../src/score/metrics.ts';
import type { ScoringRecord } from '../src/score/run-folder.ts';
import { summarize } from '../src/score/stats.ts';
import { CLAMP_DIFF, CLAMPED_MATH, usage } from './run-folders.ts';

describe('summarize', () => {
  it('gives the mean, sample standard deviation, min and max', () => {
    expect(summarize([1, 2, 3])).toEqual({ n: 3, mean: 2, sd: 1, min: 1, max: 3 });
  });

  it('has no spread for one run and nothing for no runs', () => {
    expect(summarize([4])).toEqual({ n: 1, mean: 4, sd: null, min: 4, max: 4 });
    expect(summarize([])).toBeNull();
  });

  it('rounds to four decimals', () => {
    expect(summarize([1, 2])).toEqual({ n: 2, mean: 1.5, sd: 0.7071, min: 1, max: 2 });
  });
});

describe('runMetrics', () => {
  const finished: ScoringRecord = {
    run: 1,
    wallTimeMs: 90_000,
    error: null,
    result: {
      isError: false,
      totalCostUsd: 0.25,
      durationMs: 80_000,
      modelUsage: { 'claude-sonnet-5-5': usage(5000), 'claude-haiku-5-5': usage(300) },
    },
  };

  it('adds up every model, main agent and subagents', () => {
    expect(runMetrics(finished)).toEqual({
      inputTokens: 20,
      outputTokens: 5300,
      cacheReadTokens: 2000,
      cacheWriteTokens: 200,
      costUsd: 0.25,
      minutes: 1.5,
    });
  });

  it("uses Claude Code's duration when the runner has no wall time", () => {
    expect(runMetrics({ ...finished, wallTimeMs: null })?.minutes).toBeCloseTo(80_000 / 60_000);
  });

  it('skips runs that did not finish cleanly', () => {
    const errored = { ...finished, error: 'Claude Code timed out after 15 minutes' };
    const failed = {
      ...finished,
      result: finished.result && { ...finished.result, isError: true },
    };
    for (const record of [errored, failed, { ...finished, result: null }]) {
      expect(isScorable(record)).toBe(false);
      expect(runMetrics(record)).toBeNull();
    }
    expect(isScorable(finished)).toBe(true);
  });
});

describe('scoreComments', () => {
  it('counts filler comments on the lines the run added, with the shipped rules', () => {
    expect(scoreComments(CLAMP_DIFF, { 'src/math.ts': CLAMPED_MATH })).toEqual({
      comments: 1,
      addedLines: 3,
      byRule: { 'OLDMAN-C01': 1 },
    });
  });

  it("does not count the starter's own comments", () => {
    const content = `// Updated the totals here\n${CLAMPED_MATH.replace('// Added clamp function\n', '')}`;
    const diff = CLAMP_DIFF.replace('+// Added clamp function\n', '').replace('+3,6', '+3,5');
    expect(scoreComments(diff, { 'src/math.ts': content }).comments).toBe(0);
  });

  it('skips deleted files, files the rules do not read and files without final text', () => {
    const deleted = `diff --git a/src/old.ts b/src/old.ts
deleted file mode 100644
--- a/src/old.ts
+++ /dev/null
@@ -1 +0,0 @@
-// Removed
`;
    const docs = `diff --git a/README.md b/README.md
--- a/README.md
+++ b/README.md
@@ -1 +1,2 @@
 # App
+// Added a line that looks like a comment
`;
    expect(scoreComments(deleted + docs, { 'README.md': '# App\n// Added a line\n' })).toEqual({
      comments: 0,
      addedLines: 0,
      byRule: {},
    });
    expect(scoreComments(CLAMP_DIFF, {}).addedLines).toBe(0);
  });

  it('counts a banner comment in a new file', () => {
    const diff = `diff --git a/src/new.ts b/src/new.ts
new file mode 100644
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,2 @@
+// ==========
+export const one = 1;
`;
    expect(
      scoreComments(diff, { 'src/new.ts': '// ==========\nexport const one = 1;\n' }),
    ).toMatchObject({ comments: 1, addedLines: 2, byRule: { 'OLDMAN-C05': 1 } });
  });

  it('counts a comment two rules flag once, and keeps both rules', () => {
    const diff = CLAMP_DIFF.replace(
      '+export const clamp = (v: number, lo: number, hi: number): number =>\n+  Math.min(Math.max(v, lo), hi);\n',
      '+export function clamp(v: number, lo: number, hi: number): number {\n+  return Math.min(Math.max(v, lo), hi);\n+}\n',
    ).replace('+1,3 +1,6', '+1,3 +1,7');
    const content = CLAMPED_MATH.replace(
      'export const clamp = (v: number, lo: number, hi: number): number =>\n  Math.min(Math.max(v, lo), hi);\n',
      'export function clamp(v: number, lo: number, hi: number): number {\n  return Math.min(Math.max(v, lo), hi);\n}\n',
    );
    expect(scoreComments(diff, { 'src/math.ts': content })).toEqual({
      comments: 1,
      addedLines: 4,
      byRule: { 'OLDMAN-C01': 1, 'OLDMAN-C02': 1 },
    });
  });
});
