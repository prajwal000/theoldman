// Finds comments in JS and TS with a one-pass scanner, not a parser: it skips strings, template
// literals (with nested `${}`) and regex literals, telling a regex from a division by the token
// before the `/`. Cases it gets wrong are `it.todo` in comments.known-gaps.test.ts.

import { skipRegex, skipString } from './js-tokens.js';

export type CommentKind = 'line' | 'block' | 'jsdoc';

export interface SourceComment {
  /** 1-based line where the comment starts. */
  readonly line: number;
  /** 1-based line where it ends; the same as `line` except for multi-line block comments. */
  readonly endLine: number;
  /** The comment without `//`, `/*`, `*\/` or leading `*`, trimmed; lines joined with `\n`. */
  readonly text: string;
  /** The same cleaned text per source line: `lines[i]` is on line `line + i`. */
  readonly lines: readonly string[];
  readonly kind: CommentKind;
  /** Code comes before it on the same line, as in `count++; // retry`. */
  readonly trailing: boolean;
}

const SUPPORTED = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/i;
// After one of these, `/` starts a regex literal; after a name, number, `)` or `]` it divides.
// `<` is left out: in JSX, `</a>` is far more common than a regex after a less-than sign.
const BEFORE_REGEX = new Set('(,=:[!&|?{};+-*%>~^'.split(''));
const KEYWORDS_BEFORE_REGEX = new Set(
  'return typeof case do else in of new delete void throw yield await instanceof'.split(' '),
);

// In JSX text, `https://example.com` is not a comment: `//` right after a URL scheme is text.
const URL_SCHEME_BEFORE = /[A-Za-z][\w+.-]*:$/;

export function supportsComments(file: string): boolean {
  return SUPPORTED.test(file);
}

const blockLines = (body: string): string[] =>
  body.split(/\r?\n/).map((line) =>
    line
      .trim()
      .replace(/^\*\s?/, '')
      .trim(),
  );

/** Comments in `source`; pass `file` so `.jsx` / `.tsx` get the JSX URL rule above. */
export function extractComments(source: string, file = ''): SourceComment[] {
  const jsx = /\.[jt]sx$/i.test(file);
  const comments: SourceComment[] = [];
  const length = source.length;
  let line = 1;
  let lineHasCode = false;
  let previous = '';

  const markCode = (token: string): void => {
    lineHasCode = true;
    previous = token;
  };

  /** Index after a template literal; `${...}` expressions are scanned as code. */
  const skipTemplate = (start: number): number => {
    let i = start + 1;
    while (i < length) {
      const char = source[i];
      if (char === '`') return i + 1;
      if (char === '\n' || (char === '\\' && source[i + 1] === '\n')) line++;
      if (char === '$' && source[i + 1] === '{') {
        i = scan(i + 2, true);
      } else {
        i += char === '\\' ? 2 : 1;
      }
    }
    return length;
  };

  const comment = (start: number, kind: CommentKind, end: number, lines: string[]): void => {
    const extra = source.slice(start, end).split('\n').length - 1;
    const text = lines.join('\n').trim();
    comments.push({ line, endLine: line + extra, text, lines, kind, trailing: lineHasCode });
    line += extra;
    if (extra > 0) lineHasCode = false;
  };

  /** Scans code from `start`; inside `${...}` it stops after the `}` that closes it. */
  function scan(start: number, inTemplate: boolean): number {
    let depth = 0;
    let i = start;
    while (i < length) {
      const char = source.charAt(i);
      const next = source.charAt(i + 1);
      if (char === '\n') {
        line++;
        lineHasCode = false;
        i++;
      } else if (
        char === '/' &&
        next === '/' &&
        jsx &&
        URL_SCHEME_BEFORE.test(source.slice(Math.max(0, i - 32), i))
      ) {
        markCode('/');
        i += 2;
      } else if (char === '/' && next === '/') {
        const end = source.indexOf('\n', i) === -1 ? length : source.indexOf('\n', i);
        comment(i, 'line', end, [source.slice(i + 2, end).trim()]);
        i = end;
      } else if (char === '/' && next === '*') {
        const close = source.indexOf('*/', i + 2);
        const end = close === -1 ? length : close + 2;
        const jsdoc = source[i + 2] === '*' && source[i + 3] !== '/';
        const body = source.slice(i + (jsdoc ? 3 : 2), close === -1 ? length : close);
        comment(i, jsdoc ? 'jsdoc' : 'block', end, blockLines(body));
        i = end;
      } else if (char === '"' || char === "'") {
        i = skipString(source, i);
        markCode('"');
      } else if (char === '`') {
        markCode('`');
        i = skipTemplate(i);
        // The template is a value, whatever its last `${}` ended with: a `/` after it divides.
        previous = '`';
      } else if (
        char === '/' &&
        (previous === '' || BEFORE_REGEX.has(previous) || KEYWORDS_BEFORE_REGEX.has(previous))
      ) {
        const end = skipRegex(source, i);
        markCode(end === -1 ? '/' : 'regex');
        i = end === -1 ? i + 1 : end;
      } else if (inTemplate && char === '}' && depth === 0) {
        markCode('}');
        return i + 1;
      } else if (/\s/.test(char)) {
        i++;
      } else {
        const word = /^[\w$]+/.exec(source.slice(i, i + 64))?.[0] ?? char;
        if (char === '{') depth++;
        if (char === '}') depth--;
        markCode(word);
        i += word.length;
      }
    }
    return i;
  }

  // A shebang line is not a comment and not code; skip it.
  const shebangEnd = source.indexOf('\n');
  scan(source.startsWith('#!') ? (shebangEnd === -1 ? length : shebangEnd) : 0, false);
  return comments;
}
