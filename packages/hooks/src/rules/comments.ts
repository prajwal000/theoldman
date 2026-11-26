// Comment rules on the lines an edit added to a JS or TS file. Each finding is a Fix: the edit has
// happened, so Claude is asked to change the comment.
//
// OLDMAN-C01 change narration (`// Added retry logic`, `// Updated to use v2`), which belongs in
// the commit message. A past-tense verb only counts when an edit-like word follows it, so
// `// Fixed-size buffer` and `// Updated every hour by cron` describe the code and pass. A
// comment of four words or fewer that opens with an edit verb (`// Fixed bug`) also counts.
// OLDMAN-C04 a TODO, FIXME or HACK with no `(#123)`, `(name)` or link.
// OLDMAN-C05 banner and divider comments: four or more `=`, `-`, `*`, `#` or `/` in a row.
// Allow-listed comments (comment-allow.ts: license headers, TSDoc on exports, directives with a
// reason, URLs and issue references) are never checked.

import { extractComments, supportsComments } from '../lib/comments.js';
import type { Finding, Rule, RuleInput } from '../lib/rules.js';
import { isAllowedComment } from './comment-allow.js';

export interface CommentLine {
  /** 1-based line in the file. */
  readonly line: number;
  readonly text: string;
}

/** Each non-empty line of each comment the edit added that is not allow-listed, with its line. */
export function addedCommentLines(input: RuleInput): CommentLine[] {
  if (!supportsComments(input.file)) return [];
  const added = new Set(input.addedLines.map(({ line }) => line));
  const lines = input.content.split(/\r?\n/);
  return extractComments(input.content, input.file)
    .filter((comment) => !isAllowedComment(comment, lines))
    .flatMap((comment) => comment.lines.map((text, i) => ({ line: comment.line + i, text })))
    .filter(({ line, text }) => text !== '' && added.has(line));
}

/** `word` at the start of a comment, followed by `:`, the end, or one of `follows`. */
const verb = (word: string, follows: string): RegExp =>
  new RegExp(`^${word}(?=\\s*(?::|$)|\\s+(?:${follows})\\b)`, 'i');

const ARTICLES = 'the|a|an|this|that|it';
const NARRATION: readonly RegExp[] = [
  verb(
    'added',
    `${ARTICLES}|for|support|missing|new|logging|retry|retries|checks?|validation|tests?`,
  ),
  verb('updated', `${ARTICLES}|to|for|per|so|with|logic|code|version|deps|dependencies`),
  verb('fixed', `${ARTICLES}|bugs?|issues?|typo|crash|errors?|for|in|by|so`),
  verb('changed', `${ARTICLES}|from|to|so`),
  verb('removed', `${ARTICLES}|unused|old|dead|deprecated`),
  // "Replaced X with Y" and "Renamed X to Y" name what changed before the telling word.
  /^replaced\b.*\b(?:with|by)\b/i,
  /^renamed\b.*\b(?:from|to)\b/i,
  verb('moved', 'from|to|here|out|into'),
  /^refactored\b/i,
  /^new:/i,
  /^now (?:we|uses?|returns?|handles?|supports?|calls?|works?)\b/i,
  /^this used to\b/i,
  /^this was (?:causing|broken|failing|wrong|buggy|a bug|the bug|slow|missing|returning|throwing|crashing|(?:added|changed|removed|moved|renamed|replaced|refactored|fixed|updated)\b)/i,
  /^previously\b/i,
  /^no longer (?:needed|used|required|necessary|works?)\b/i,
  /^as requested\b/i,
  /^per (?:your |the |user |pr |code )?(?:request|review|feedback)\b/i,
  /^(?:fix|bugfix|hotfix)(?::|\s+for\b)/i,
  /^(?:was|old):/i,
];

// A short comment that opens with an edit verb is a change note even without a telling word:
// `// Fixed bug`, `// Updated logic`, `// New function`. The verb must be a whole word, so
// `// Fixed-size buffer` and `// Now() is UTC here` are not caught.
const SHORT_NARRATION = /^(?:added|updated|fixed|changed|removed|refactored|new|now)(?=[\s:]|$)/i;
const isShortNarration = (text: string): boolean =>
  SHORT_NARRATION.test(text) && text.split(/\s+/).length <= 4;

const MARKER = /\b(?:TODO|FIXME|HACK)\b(\([^)\s]+\))?/;
const DIVIDER = /([=\-*#/])\1{3,}/;

function commentRule(id: Finding['id'], message: string, matches: (text: string) => boolean): Rule {
  return (input) =>
    addedCommentLines(input)
      .filter(({ text }) => matches(text))
      .map(({ line }) => ({ id, action: 'fix', file: input.file, line, message }));
}

export const c01 = commentRule(
  'OLDMAN-C01',
  'Move change notes to the commit message; a comment should say why the code is as it is.',
  (text) => NARRATION.some((pattern) => pattern.test(text)) || isShortNarration(text),
);

export const c04 = commentRule(
  'OLDMAN-C04',
  'Link the TODO to an issue or owner, as in TODO(#123) or TODO(name), or remove it.',
  (text) => {
    const marker = MARKER.exec(text);
    return marker !== null && marker[1] === undefined;
  },
);

export const c05 = commentRule(
  'OLDMAN-C05',
  'Remove the divider comment; group code with functions, modules or files instead.',
  (text) => DIVIDER.test(text),
);
