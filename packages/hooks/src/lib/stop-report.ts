import { formatFindings } from './output.js';
import type { Finding } from './rules.js';

// Block reasons and system messages are capped by Claude Code at 10,000 characters.
const MAX_LISTED = 20;

export interface StopReport {
  /** `light`: Claude checks the diff itself; `full` (default): the reviewer and verifier do. */
  readonly kind?: 'light' | 'full';
  /** Set when Claude should have this diff file reviewed. */
  readonly diffPath?: string | undefined;
  /** The topic rules the reviewer and verifier read, for a full review. */
  readonly rulesPath?: string | undefined;
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

const LIGHT_CHECKS =
  'wrong conditions and off-by-one errors, unhandled null or errors, missing await, missing authentication or ownership checks, unvalidated input, queries without a limit, and new behaviour without a test';

function reviewSteps(kind: 'light' | 'full', diffPath: string, rulesPath?: string): string[] {
  if (kind === 'light') {
    return [
      `1. This change is small, so check it yourself, without subagents: go over the lines you changed for ${LIGHT_CHECKS}. The diff is at ${diffPath} if you need it. Fix what you find, then run the tests again.`,
    ];
  }
  const rules = rulesPath === undefined ? '' : ` Read the topic rules in ${rulesPath} first.`;
  const files = rulesPath === undefined ? 'the same diff path' : 'the same diff and rules paths';
  return [
    `1. Run the theoldman:oldman-reviewer subagent with the prompt: Review the diff at ${diffPath}.${rules}`,
    `2. If the reviewer's reply is exactly "No issues found.", skip this step. Otherwise run the theoldman:oldman-verifier subagent with ${files} and the reviewer's full reply.`,
    '3. Fix every confirmed Critical and Important finding, then run the tests again. Mention confirmed Nits in your summary.',
  ];
}

/** The `reason` of a Stop block: what Claude must do before finishing, then the notes. */
export function blockReason(report: StopReport): string {
  const { kind = 'full', diffPath, rulesPath, fixes, capped, notes } = report;
  const steps: string[] = [];
  if (diffPath !== undefined) {
    steps.push(...reviewSteps(kind, diffPath, rulesPath));
    if (notes.some((note) => note.id === 'OLDMAN-D02')) {
      steps[0] = `${steps[0] ?? ''} Also check whether the API docs need an update for the changed routes.`;
    }
  }
  if (fixes.length > 0) {
    steps.push(`${String(steps.length + 1)}. Fix these docs findings:`, ...asLines(fixes));
  }
  // Claude already summarised its work once; a second full summary costs tokens and says little new.
  steps.push(
    'Then reply in one or two lines with what this step found or changed. Do not repeat your earlier summary.',
  );
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
