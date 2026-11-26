// A one-pass scanner for JS and TS, not a parser. It finds the parts of the source that are not
// code to match on: comments, strings, the text of template literals (their `${}` expressions
// are code) and regex literals. Whether `/` starts a regex or divides is decided from the token
// before it; the cases it gets wrong are `it.todo` in comments.known-gaps.test.ts.

import { skipRegex, skipString } from './js-tokens.js';

export type SpanKind = 'line-comment' | 'block-comment' | 'string' | 'template' | 'regex';

export interface Span {
  readonly kind: SpanKind;
  /** Offset of the first character. */
  readonly start: number;
  /** Offset after the last character. */
  readonly end: number;
}

// After one of these, `/` starts a regex literal; after a name, number, `)` or `]` it divides.
// `<` is left out: in JSX, `</a>` is far more common than a regex after a less-than sign.
const BEFORE_REGEX = new Set('(,=:[!&|?{};+-*%>~^'.split(''));
const KEYWORDS_BEFORE_REGEX = new Set(
  'return typeof case do else in of new delete void throw yield await instanceof'.split(' '),
);
// In JSX text, `https://example.com` is not a comment: `//` right after a URL scheme is text.
const URL_SCHEME_BEFORE = /[A-Za-z][\w+.-]*:$/;

/** Spans of `source` in order; pass `file` so `.jsx` / `.tsx` get the JSX URL rule above. */
export function scanJs(source: string, file = ''): Span[] {
  const jsx = /\.[jt]sx$/i.test(file);
  const spans: Span[] = [];
  const length = source.length;
  let previous = '';

  /** Index after a template literal; its text becomes spans, its `${...}` is scanned as code. */
  const skipTemplate = (start: number): number => {
    let chunk = start;
    let i = start + 1;
    while (i < length) {
      const char = source[i];
      if (char === '`') {
        spans.push({ kind: 'template', start: chunk, end: i + 1 });
        return i + 1;
      }
      if (char === '$' && source[i + 1] === '{') {
        spans.push({ kind: 'template', start: chunk, end: i + 2 });
        i = scan(i + 2, true);
        chunk = i - 1;
      } else {
        i += char === '\\' ? 2 : 1;
      }
    }
    spans.push({ kind: 'template', start: chunk, end: length });
    return length;
  };

  /** Scans code from `start`; inside `${...}` it stops after the `}` that closes it. */
  function scan(start: number, inTemplate: boolean): number {
    let depth = 0;
    let i = start;
    while (i < length) {
      const char = source.charAt(i);
      const next = source.charAt(i + 1);
      if (
        char === '/' &&
        next === '/' &&
        jsx &&
        URL_SCHEME_BEFORE.test(source.slice(Math.max(0, i - 32), i))
      ) {
        previous = '/';
        i += 2;
      } else if (char === '/' && next === '/') {
        const newline = source.indexOf('\n', i);
        const end = newline === -1 ? length : newline;
        spans.push({ kind: 'line-comment', start: i, end });
        i = end;
      } else if (char === '/' && next === '*') {
        const close = source.indexOf('*/', i + 2);
        const end = close === -1 ? length : close + 2;
        spans.push({ kind: 'block-comment', start: i, end });
        i = end;
      } else if (char === '"' || char === "'") {
        const end = skipString(source, i);
        spans.push({ kind: 'string', start: i, end });
        previous = '"';
        i = end;
      } else if (char === '`') {
        i = skipTemplate(i);
        // The template is a value, whatever its last `${}` ended with: a `/` after it divides.
        previous = '`';
      } else if (
        char === '/' &&
        (previous === '' || BEFORE_REGEX.has(previous) || KEYWORDS_BEFORE_REGEX.has(previous))
      ) {
        const end = skipRegex(source, i);
        if (end !== -1) spans.push({ kind: 'regex', start: i, end });
        previous = end === -1 ? '/' : 'regex';
        i = end === -1 ? i + 1 : end;
      } else if (inTemplate && char === '}' && depth === 0) {
        previous = '}';
        return i + 1;
      } else if (/\s/.test(char)) {
        i++;
      } else {
        const word = /^[\w$]+/.exec(source.slice(i, i + 64))?.[0] ?? char;
        if (char === '{') depth++;
        if (char === '}') depth--;
        previous = word;
        i += word.length;
      }
    }
    return i;
  }

  // A shebang line is not a comment and not code; skip it.
  const shebangEnd = source.indexOf('\n');
  scan(source.startsWith('#!') ? (shebangEnd === -1 ? length : shebangEnd) : 0, false);
  return spans;
}
