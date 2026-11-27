// Filler comments a run added, found by theoldman's own comment rules (OLDMAN-C01 to C06), the
// same code the plugin's edit check runs. Only lines the run added count, in the files the rules
// read, so the starter's own comments never count against either arm.

import { supportsComments } from '../../../packages/hooks/src/lib/comments.js';
import { parseDiff } from '../../../packages/hooks/src/lib/diff.js';
import { checkType, runChecks } from '../../../packages/hooks/src/rules/check.js';

export interface CommentScore {
  /**
   * Added lines at least one comment rule flagged. `// Added clamp function` above
   * `function clamp` is both narration (C01) and a repeat of the code (C02), but one comment.
   */
  readonly comments: number;
  /** Lines the run added to files the comment rules read. */
  readonly addedLines: number;
  /** Findings per rule, so one line can count under several rules. */
  readonly byRule: Readonly<Record<string, number>>;
}

/**
 * Runs the comment rules on each changed file's final text (from the scoring container) and the
 * lines the diff added to it.
 */
export function scoreComments(diff: string, files: Readonly<Record<string, string>>): CommentScore {
  const flagged = new Set<string>();
  let addedLines = 0;
  const byRule: Record<string, number> = {};
  for (const file of parseDiff(diff)) {
    const content = files[file.path];
    if (file.status === 'deleted' || content === undefined || !supportsComments(file.path)) {
      continue;
    }
    addedLines += file.addedLines.length;
    const findings = runChecks({ file: file.path, content, addedLines: file.addedLines }).filter(
      (finding) => checkType(finding) === 'comments',
    );
    for (const finding of findings) {
      byRule[finding.id] = (byRule[finding.id] ?? 0) + 1;
      flagged.add(`${file.path}:${String(finding.line)}`);
    }
  }
  return { comments: flagged.size, addedLines, byRule };
}
