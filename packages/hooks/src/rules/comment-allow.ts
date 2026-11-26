// Comments that no comment rule flags and that do not count toward comment density (SPEC: "Not
// flagged"): license headers, TSDoc on exported declarations, `eslint-disable` and
// `@ts-expect-error` with a reason, TypeScript triple-slash directives, and comments with a URL
// or an issue reference. Shebangs never reach the rules: the comment extractor skips them.

import type { SourceComment } from '../lib/comments.js';

/** A URL or an issue reference: such a comment points somewhere, so it earns its place. */
export const REFERENCE = /https?:\/\/\S|#\d+\b/;

const LICENSE =
  /\b(?:copyright|licen[cs]ed?|spdx-license-identifier)\b|@license\b|@preserve\b|\(c\)\s*\d{4}/i;
// ESLint takes a reason after ` -- `; @ts-expect-error takes any text after it.
const DIRECTIVE_WITH_REASON =
  /^(?:eslint-disable(?:-next-line|-line)?\b.*\s--\s+\S|@ts-expect-error\b[:\s]+\S)/;
// The extractor drops `//`, so `/// <reference ... />` arrives as `/ <reference ... />`.
const TRIPLE_SLASH = /^\/\s*<(?:reference|amd-module)\b/;
const EXPORT = /^export\b/;

/** The first line after `afterLine` that holds code: not blank, a comment or a decorator. */
export function nextCodeLine(
  lines: readonly string[],
  afterLine: number,
  skipDecorators = false,
): string | undefined {
  return lines
    .slice(afterLine)
    .map((line) => line.trim())
    .find(
      (line) =>
        line !== '' && !/^(?:\/\/|\/\*|\*)/.test(line) && !(skipDecorators && line.startsWith('@')),
    );
}

/**
 * Whether no comment rule should flag `comment`. Pass `references: false` to leave URLs and issue
 * references out, for a rule that checks them line by line instead.
 */
export function isAllowedComment(
  comment: SourceComment,
  lines: readonly string[],
  { references = true } = {},
): boolean {
  const { text } = comment;
  if ((references && REFERENCE.test(text)) || LICENSE.test(text)) return true;
  if (DIRECTIVE_WITH_REASON.test(text) || TRIPLE_SLASH.test(text)) return true;
  if (comment.kind !== 'jsdoc') return false;
  return EXPORT.test(nextCodeLine(lines, comment.endLine, true) ?? '');
}
