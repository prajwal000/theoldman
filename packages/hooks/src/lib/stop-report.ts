import { formatFindings } from './output.js';
import type { Finding } from './rules.js';

// Block reasons and system messages are capped by Claude Code at 10,000 characters.
const MAX_LISTED = 20;

export interface StopReport {
  /** Set when Claude should have this diff file reviewed. */
  readonly diffPath?: string | undefined;
  /** Docs findings to fix now (OLDMAN-D01). */
  readonly fixes: readonly Finding[];
  /** Findings left after the feedback limit, already formatted one per line. */
  readonly capped: readonly string[];
  /** Docs warnings (OLDMAN-D02 to D04). */
  readonly notes: readonly Finding[];
}

function section(title: string, lines: readonly string[]): string[] {
  if (lines.length === 0) return [];
  const more = lines.length - MAX_LISTED;
  return [
    '',
    title,
    ...lines.slice(0, MAX_LISTED),
    ...(more > 0 ? [`...and ${String(more)} more.`] : []),
  ];
}

const asLines = (findings: readonly Finding[]): string[] =>
  findings.length === 0 ? [] : formatFindings(findings).split('\n');

/** The `reason` of a Stop block: what Claude must do before finishing, then the notes. */
export function blockReason({ diffPath, fixes, capped, notes }: StopReport): string {
  const steps: string[] = [];
  if (diffPath !== undefined) {
    const apiDocs = notes.some((note) => note.id === 'OLDMAN-D02')
      ? ' Also check whether the API docs need an update for the changed routes.'
      : '';
    steps.push(
      `1. Run the theoldman:oldman-reviewer subagent with the prompt: Review the diff at ${diffPath}.${apiDocs}`,
      "2. Run the theoldman:oldman-verifier subagent with the same diff path and the reviewer's full reply.",
      '3. Fix every confirmed Critical and Important finding, then run the tests again. Mention confirmed Nits in your summary.',
    );
  }
  if (fixes.length > 0) {
    steps.push(`${String(steps.length + 1)}. Fix these docs findings:`, ...asLines(fixes));
  }
  return [
    'theoldman: code changed in this session. Before you finish:',
    ...steps,
    ...section('Left after the feedback limit; mention them in your summary:', capped),
    ...section('Notes, no fix required:', asLines(notes)),
  ].join('\n');
}

/** A message for the user when the hook does not block, or undefined when there is nothing. */
export function userNotice(report: StopReport, reviewSkipped?: string): string | undefined {
  const lines = [
    ...(reviewSkipped === undefined ? [] : ['', `Review skipped: ${reviewSkipped}.`]),
    ...section('Not fixed after the feedback limit:', [...report.capped, ...asLines(report.fixes)]),
    ...section('Notes:', asLines(report.notes)),
  ];
  return lines.length === 0 ? undefined : ['theoldman:', ...lines.slice(1)].join('\n');
}
