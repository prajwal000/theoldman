// OLDMAN-C06 (Warn): an edit that adds more than 1 comment line per 5 lines of code in one file.
// Comment lines are the non-empty lines of comments that are not allow-listed (comment-allow.ts);
// a line with a trailing comment counts as both code and comment. A single why-comment on a small
// edit is fine, so the warning also needs at least MIN_COMMENT_LINES comment lines.

import { extractComments, supportsComments } from '../lib/comments.js';
import type { Rule } from '../lib/rules.js';
import { isAllowedComment } from './comment-allow.js';

const CODE_LINES_PER_COMMENT_LINE = 5;
const MIN_COMMENT_LINES = 3;

export const c06: Rule = (input) => {
  if (!supportsComments(input.file)) return [];
  const lines = input.content.split(/\r?\n/);
  const comments = extractComments(input.content, input.file);
  // Lines that hold only comment text, so they are not code.
  const commentOnly = new Set(
    comments.flatMap((comment) =>
      comment.lines.map((_, i) => comment.line + i).filter((line, i) => i > 0 || !comment.trailing),
    ),
  );
  const commentLines = comments
    .filter((comment) => !isAllowedComment(comment, lines))
    .flatMap((comment) => comment.lines.map((text, i) => ({ line: comment.line + i, text })))
    .filter(({ text }) => text !== '')
    .map(({ line }) => line);
  const added = input.addedLines.filter(({ text }) => text.trim() !== '');
  const addedNumbers = new Set(added.map(({ line }) => line));
  const addedComments = commentLines.filter((line) => addedNumbers.has(line));
  const addedCode = added.filter(({ line }) => !commentOnly.has(line)).length;
  const [first] = addedComments;
  if (
    first === undefined ||
    addedComments.length < MIN_COMMENT_LINES ||
    addedComments.length * CODE_LINES_PER_COMMENT_LINE <= addedCode
  ) {
    return [];
  }
  return [
    {
      id: 'OLDMAN-C06',
      action: 'warn',
      file: input.file,
      line: first,
      message: `This edit adds ${String(addedComments.length)} comment lines for ${String(addedCode)} lines of code (more than 1 per 5); keep only the comments that say why.`,
    },
  ];
};
