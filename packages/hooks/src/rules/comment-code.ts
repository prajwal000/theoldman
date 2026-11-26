// Comment rules that compare a comment with code.
//
// OLDMAN-C02 (Warn): a comment that restates the next line, as in `// get user` above
// `const user = getUser()`. Most of its words, after stemming, appear among that line's
// identifiers (split at camelCase and snake_case) or the words its operators stand for
// (`++` increment, `=` set, `new` create). Long comments, comments that give a reason
// ("because", "so that", ...), references, JSDoc and trailing comments are left alone.
// OLDMAN-C03 (Fix): commented-out code, such as `// const x = 1;` or `// if (a) {`. Prose that
// ends with a period and JSDoc (where `@example` code belongs) pass. A URL or `#123` exempts only
// its own line, so a link at the top of a block comment does not hide code below it. A run of
// commented-out lines is reported once, at its first line.

import { extractComments, type SourceComment, supportsComments } from '../lib/comments.js';
import type { Finding, Rule, RuleInput } from '../lib/rules.js';
import { isAllowedComment, nextCodeLine, REFERENCE } from './comment-allow.js';

/**
 * Comments of a JS or TS file that start on, or reach into, a line the edit added, minus the
 * allow-listed ones (comment-allow.ts). `references: false` keeps comments that are allowed only
 * because of a URL or issue reference, for a rule that checks those line by line.
 */
export function addedComments(input: RuleInput, { references = true } = {}): SourceComment[] {
  if (!supportsComments(input.file)) return [];
  const added = new Set(input.addedLines.map(({ line }) => line));
  const lines = input.content.split(/\r?\n/);
  return extractComments(input.content, input.file).filter(
    (comment) =>
      comment.lines.some((_, i) => added.has(comment.line + i)) &&
      !isAllowedComment(comment, lines, { references }),
  );
}

const STOP_WORDS = new Set(
  'the a an to of and or for in on at with this that it its is are be by from as into over then if we our'.split(
    ' ',
  ),
);
const REASON =
  /\b(?:because|since|so that|otherwise|instead|workaround|why|unless|until|must|never|always)\b/i;
const OPERATOR_WORDS: readonly (readonly [RegExp, string])[] = [
  [/\+\+|\+=/, 'increment add'],
  [/--|-=/, 'decrement'],
  [/[^=!<>]=[^=>]/, 'set assign store'],
  [/\bnew\b/, 'create'],
  [/\bif\b/, 'check'],
  [/\b(?:for|while|forEach|map)\b/, 'loop iterate'],
  [/\bconsole\b/, 'log print'],
  [/\bawait\b/, 'wait'],
  [/\.push\(/, 'add append'],
];

/** Lower case with simple English endings removed, so `items`, `writes` and `counted` match. */
function stem(word: string): string {
  const w = word.toLowerCase();
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

/** Words of `text`, splitting identifiers at camelCase, PascalCase, digits and underscores. */
function words(text: string): string[] {
  const spaced = text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
  return (spaced.match(/[A-Za-z]+/g) ?? []).map(stem);
}

function codeWords(code: string): Set<string> {
  const found = new Set(words(code));
  for (const [pattern, synonyms] of OPERATOR_WORDS) {
    if (pattern.test(code)) for (const word of synonyms.split(' ')) found.add(word);
  }
  return found;
}

function restates(comment: SourceComment, lines: readonly string[]): boolean {
  if (comment.trailing || comment.kind === 'jsdoc' || comment.endLine !== comment.line)
    return false;
  if (REFERENCE.test(comment.text) || REASON.test(comment.text)) return false;
  const content = words(comment.text).filter((word) => !STOP_WORDS.has(word));
  const code = nextCodeLine(lines, comment.endLine);
  if (content.length === 0 || content.length > 8 || code === undefined) return false;
  const known = codeWords(code);
  return content.filter((word) => known.has(word)).length / content.length >= 0.6;
}

const CODE_PATTERNS: readonly RegExp[] = [
  /;$/,
  /\{$/,
  /^\}/,
  /^(?:const|let|var)\s+[\w$[{]/,
  /^(?:if|for|while|switch|catch)\s*\(/,
  /^(?:import|export)\s.*(?:\bfrom\s+['"]|[{}*;]|\bdefault\b)/,
  /^(?:await|throw|return)\s+[\w$.]+\(/,
  /^(?:function|class)\s+[\w$]+\s*[({<]/,
  /^[\w$]+(?:\.[\w$]+)*\(.*\)$/,
  /^[\w$.]+\s*[+\-*/%]?=\s*\S+$/,
];

function looksLikeCode(text: string): boolean {
  if (text === '' || REFERENCE.test(text) || (text.endsWith('.') && !text.endsWith('..')))
    return false;
  return CODE_PATTERNS.some((pattern) => pattern.test(text));
}

export const c02: Rule = (input) => {
  const lines = input.content.split(/\r?\n/);
  return addedComments(input)
    .filter((comment) => restates(comment, lines))
    .map((comment): Finding => ({
      id: 'OLDMAN-C02',
      action: 'warn',
      file: input.file,
      line: comment.line,
      message: 'This comment repeats what the next line says; explain why instead, or delete it.',
    }));
};

export const c03: Rule = (input) => {
  const added = new Set(input.addedLines.map(({ line }) => line));
  // looksLikeCode skips a line with a URL or `#123`, so the exemption applies per line here.
  const codeLines = addedComments(input, { references: false })
    .filter((comment) => comment.kind !== 'jsdoc')
    .flatMap((comment) => comment.lines.map((text, i) => ({ line: comment.line + i, text })))
    .filter(({ line, text }) => added.has(line) && looksLikeCode(text))
    .map(({ line }) => line);
  const runStarts = codeLines.filter((line) => !codeLines.includes(line - 1));
  return runStarts.map((line) => ({
    id: 'OLDMAN-C03',
    action: 'fix',
    file: input.file,
    line,
    message: 'Delete the commented-out code; git keeps the old version if it is needed again.',
  }));
};
