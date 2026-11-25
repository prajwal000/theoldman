import type { AddedLine } from './added-lines.js';

/**
 * What a hook asks of Claude: `block` stops a tool call (PreToolUse only), `fix` asks for a
 * change after an edit or before stopping, `warn` only informs.
 */
export type Action = 'block' | 'fix' | 'warn';

export interface Finding {
  readonly id: `OLDMAN-${string}`;
  readonly action: Action;
  readonly file: string;
  readonly line: number;
  readonly message: string;
}

/** What a rule sees: one file, its whole content, and the lines this edit added. */
export interface RuleInput {
  readonly file: string;
  readonly content: string;
  readonly addedLines: readonly AddedLine[];
}

export type Rule = (input: RuleInput) => readonly Finding[];
