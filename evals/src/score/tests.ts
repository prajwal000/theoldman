// Hidden-test pass rate and tests added, from the vitest counts the scoring container took with
// the hidden tests copied in: once on the untouched starter, once on the finished project.
//
// A hidden file that fails to load on the finished project reports no tests, so each hidden file
// is owed at least the tests it had on the starter; otherwise breaking the import would shrink
// the denominator instead of failing the tests. Tests added is the number of the project's own
// tests that ran (passed or failed) at the end, minus the number on the starter.

import type { TestCounts, WorkspaceReport } from './workspace.ts';

export interface TestScore {
  /** Passed hidden tests over all hidden tests, from 0 to 1; null when they could not run. */
  readonly hiddenPassRate: number | null;
  readonly testsAdded: number | null;
  readonly notes: readonly string[];
}

const ran = (counts: TestCounts | undefined): number =>
  counts === undefined ? 0 : counts.passed + counts.failed;

export function scoreTests({ hidden, starter, final }: WorkspaceReport['tests']): TestScore {
  const notes: string[] = [];
  const hiddenSet = new Set(hidden);
  const ownTests = (files: NonNullable<typeof final>): number =>
    Object.entries(files)
      .filter(([path]) => !hiddenSet.has(path))
      .reduce((sum, [, counts]) => sum + ran(counts), 0);
  const testsAdded =
    starter !== null && final !== null ? ownTests(final) - ownTests(starter) : null;
  if (final === null) return { hiddenPassRate: null, testsAdded, notes };

  let passed = 0;
  let total = 0;
  for (const path of hidden) {
    const before = starter?.[path];
    const after = final[path];
    // Helper files in the hidden folder are not test files and appear in neither run.
    if (before === undefined && after === undefined) continue;
    if (before?.loaded !== true) {
      notes.push(
        `hidden test file ${path} did not load on the starter, so its test count is taken from the finished project alone`,
      );
    }
    if (after === undefined) notes.push(`vitest did not run hidden test file ${path}`);
    passed += after?.passed ?? 0;
    total += Math.max(ran(before), ran(after));
  }
  if (total === 0) {
    notes.push('no hidden tests ran: there is no hidden-test pass rate');
    return { hiddenPassRate: null, testsAdded, notes };
  }
  return { hiddenPassRate: passed / total, testsAdded, notes };
}
