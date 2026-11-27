// Security findings a run added. Semgrep runs the pinned semgrep-rules JavaScript and TypeScript
// rules on the files the run changed, and a finding counts only if it covers a line the run
// added, so the starter's own code never counts against either arm. gitleaks reads only the
// run's changes, so all of its findings count. Findings carry the rule and place, never the
// matched text, so a detected secret is never stored.

import { parseDiff } from '../../../packages/hooks/src/lib/diff.js';
import type { ToolFinding } from './workspace.ts';

export interface SecurityScore {
  /** Null when Semgrep could not scan. */
  readonly semgrep: number | null;
  /** Null when gitleaks could not scan. */
  readonly gitleaks: number | null;
  /** Counted findings by rule, both tools together. */
  readonly byRule: Readonly<Record<string, number>>;
}

export function scoreSecurity(
  diff: string,
  semgrep: readonly ToolFinding[] | null,
  gitleaks: readonly ToolFinding[] | null,
): SecurityScore {
  const added = new Map<string, ReadonlySet<number>>();
  for (const file of parseDiff(diff)) {
    added.set(file.path, new Set(file.addedLines.map(({ line }) => line)));
  }
  const onAddedLine = ({ path, line, endLine }: ToolFinding): boolean => {
    const lines = added.get(path);
    if (lines === undefined) return false;
    for (let at = line; at <= endLine; at++) if (lines.has(at)) return true;
    return false;
  };

  const counted = [...(semgrep ?? []).filter(onAddedLine), ...(gitleaks ?? [])];
  const byRule: Record<string, number> = {};
  for (const { rule } of counted) byRule[rule] = (byRule[rule] ?? 0) + 1;
  return {
    semgrep: semgrep === null ? null : semgrep.filter(onAddedLine).length,
    gitleaks: gitleaks === null ? null : gitleaks.length,
    byRule,
  };
}
