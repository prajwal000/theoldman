// The Check rules that run after each Write or Edit: comment rules C01 to C06 and quality rules
// Q01 to Q04. Feedback rounds are capped per check type (SPEC §2), so the rules are grouped into
// the "comments" and "quality" types.

import type { Finding, Rule, RuleInput } from '../lib/rules.js';
import { c02, c03 } from './comment-code.js';
import { c06 } from './comment-density.js';
import { c01, c04, c05 } from './comments.js';
import { q01, q02, q03, q04 } from './quality.js';

export type CheckType = 'comments' | 'quality';

export const CHECK_TYPES: readonly CheckType[] = ['comments', 'quality'];

const RULES: readonly Rule[] = [c01, c02, c03, c04, c05, c06, q01, q02, q03, q04];

export function checkType(finding: Finding): CheckType {
  return finding.id.startsWith('OLDMAN-Q') ? 'quality' : 'comments';
}

/** Every finding of every Check rule not in `disabled`, ordered by line, then rule ID. */
export function runChecks(input: RuleInput, disabled: readonly string[] = []): Finding[] {
  return RULES.flatMap((rule) => rule(input))
    .filter((finding) => !disabled.includes(finding.id))
    .sort((a, b) => a.line - b.line || a.id.localeCompare(b.id));
}
