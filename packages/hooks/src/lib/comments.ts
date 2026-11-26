// The comments of a JS or TS file, built from the scanner in js-scan.ts, with their lines and
// whether code comes before them on their first line.

import { scanJs } from './js-scan.js';

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

/** Comments in `source`; pass `file` so `.jsx` / `.tsx` read `https://` in JSX text as text. */
export function extractComments(source: string, file = ''): SourceComment[] {
  const comments: SourceComment[] = [];
  let line = 1;
  let codeLine = 0;
  let position = 0;

  /** Moves to `to`, counting lines and noting the last line that holds code. */
  const advance = (to: number, isCode: boolean): void => {
    for (let i = position; i < to; i++) {
      const char = source[i];
      if (char === '\n') line++;
      else if (isCode && char !== ' ' && char !== '\t' && char !== '\r') codeLine = line;
    }
    position = to;
  };

  for (const span of scanJs(source, file)) {
    advance(span.start, true);
    if (span.kind !== 'line-comment' && span.kind !== 'block-comment') {
      advance(span.end, true);
      continue;
    }
    const startLine = line;
    const trailing = codeLine === startLine;
    let kind: CommentKind = 'line';
    let lines = [source.slice(span.start + 2, span.end).trim()];
    if (span.kind === 'block-comment') {
      const closed = span.end - span.start >= 4 && source.slice(span.end - 2, span.end) === '*/';
      const jsdoc = source[span.start + 2] === '*' && source[span.start + 3] !== '/';
      kind = jsdoc ? 'jsdoc' : 'block';
      lines = blockLines(
        source.slice(span.start + (jsdoc ? 3 : 2), closed ? span.end - 2 : span.end),
      );
    }
    advance(span.end, false);
    comments.push({
      line: startLine,
      endLine: line,
      text: lines.join('\n').trim(),
      lines,
      kind,
      trailing,
    });
  }
  return comments;
}
