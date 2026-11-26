import { describe, expect, it } from 'vitest';
import { extractComments, supportsComments } from '../../src/lib/comments.js';

/** `[line, kind, text]` for each comment, the shape most tests compare. */
const found = (source: string): [number, string, string][] =>
  extractComments(source).map((c) => [c.line, c.kind, c.text]);

describe('supportsComments', () => {
  it.each(['a.ts', 'a.tsx', 'a.js', 'a.jsx', 'a.mjs', 'a.cjs', 'A.MTS', 'src\\x.cts'])(
    '%s',
    (file) => {
      expect(supportsComments(file)).toBe(true);
    },
  );

  it.each(['a.py', 'a.json', 'README.md', 'a.ts.txt'])('not %s', (file) => {
    expect(supportsComments(file)).toBe(false);
  });
});

describe('extractComments', () => {
  it('finds line comments on their own line and after code', () => {
    expect(
      extractComments('// own line\nconst a = 1; //   trailing  \n/// <reference types="node" />'),
    ).toEqual([
      { line: 1, endLine: 1, text: 'own line', kind: 'line', trailing: false },
      { line: 2, endLine: 2, text: 'trailing', kind: 'line', trailing: true },
      { line: 3, endLine: 3, text: '/ <reference types="node" />', kind: 'line', trailing: false },
    ]);
  });

  it('finds block and JSDoc comments, with end lines and the leading stars removed', () => {
    const source =
      '/* one */\n/**\n * Two lines\n *   of docs\n */\nconst x = 1; /* three\n   lines */\n/**/ /***/';
    expect(extractComments(source)).toEqual([
      { line: 1, endLine: 1, text: 'one', kind: 'block', trailing: false },
      { line: 2, endLine: 5, text: 'Two lines\nof docs', kind: 'jsdoc', trailing: false },
      { line: 6, endLine: 7, text: 'three\nlines', kind: 'block', trailing: true },
      { line: 8, endLine: 8, text: '', kind: 'block', trailing: false },
      { line: 8, endLine: 8, text: '', kind: 'jsdoc', trailing: false },
    ]);
  });

  it('ignores // and /* inside strings', () => {
    expect(found(`const url = "http://x.dev/*"; const s = 'it\\'s // not'; // real`)).toEqual([
      [1, 'line', 'real'],
    ]);
  });

  it('ends an unterminated string at the end of the line', () => {
    expect(found("const s = 'oops\n// real")).toEqual([[2, 'line', 'real']]);
  });

  it('ignores comment markers in template literals but finds real comments in ${}', () => {
    expect(found('const t = `// not ${a /* real */} /* not */ \\` // not`; // after')).toEqual([
      [1, 'block', 'real'],
      [1, 'line', 'after'],
    ]);
  });

  it('handles nested templates and braces inside ${}', () => {
    expect(found("const t = `a ${`b ${'//'} c`} ${ {k: 1}.k } // not`; // end")).toEqual([
      [1, 'line', 'end'],
    ]);
  });

  it('counts lines inside multi-line templates', () => {
    expect(found('const t = `one\ntwo // not\nthree \\\nfour`;\n// real')).toEqual([
      [5, 'line', 'real'],
    ]);
  });

  it('skips regex literals, including / inside a class and escaped slashes', () => {
    expect(
      found(
        [
          'const re = /\\/\\/ not/gi; // one',
          'const any = /[/*]/; // two',
          'if (/x\\/\\/y/.test(s)) return /a\\/b/.test(t); // three',
          'const list = [/\\/\\//, /\\/\\*/]; // four',
        ].join('\n'),
      ),
    ).toEqual([
      [1, 'line', 'one'],
      [2, 'line', 'two'],
      [3, 'line', 'three'],
      [4, 'line', 'four'],
    ]);
  });

  it('reads / after a value as division', () => {
    expect(
      found(
        'const half = total / 2 /* why */;\nconst q = (a) / b // c\nconst n = `${a}` / 2; // d\nconst r = 1.5 / x[0] / y; // e',
      ),
    ).toEqual([
      [1, 'block', 'why'],
      [2, 'line', 'c'],
      [3, 'line', 'd'],
      [4, 'line', 'e'],
    ]);
  });

  it('falls back to division when a regex would run past the end of the line or file', () => {
    expect(found('x = / not a regex\n// real')).toEqual([[2, 'line', 'real']]);
    expect(found('// real\nx = /unterminated')).toEqual([[1, 'line', 'real']]);
  });

  it('runs an unterminated template literal to the end of the file', () => {
    expect(found('// real\nconst t = `open // not')).toEqual([[1, 'line', 'real']]);
  });

  it('skips a shebang line', () => {
    expect(found('#!/usr/bin/env node\n// real')).toEqual([[2, 'line', 'real']]);
    expect(found('#!/usr/bin/env node // not a comment')).toEqual([]);
  });

  it('counts CRLF lines and runs an unterminated block comment to the end', () => {
    expect(found('a();\r\n// x\r\n/* y\r\n z */\r\nb();\r\n/* open')).toEqual([
      [2, 'line', 'x'],
      [3, 'block', 'y\nz'],
      [6, 'block', 'open'],
    ]);
  });

  it('marks trailing comments correctly around multi-line block comments', () => {
    const [first, second] = extractComments('x(); /* a\n b */ y(); // c\n/* d\n */\n// e');
    expect([first?.trailing, second?.trailing]).toEqual([true, true]);
    expect(extractComments('x(); /* a\n b */\n// c').at(-1)?.trailing).toBe(false);
  });

  it('reads JSX closing and self-closing tags as code', () => {
    expect(
      found(
        [
          'return <div className="a">{/* jsx comment */}<br /></div>; // one',
          '<List items={items.map((i) => <Item key={i} />)} /> // two',
          '</section>',
          '// three',
        ].join('\n'),
      ),
    ).toEqual([
      [1, 'block', 'jsx comment'],
      [1, 'line', 'one'],
      [2, 'line', 'two'],
      [4, 'line', 'three'],
    ]);
  });

  it('reads JSX attribute strings as strings', () => {
    expect(found('const el = <a href="http://x.dev">link</a>; // real')).toEqual([
      [1, 'line', 'real'],
    ]);
  });

  it('finds no comments in source without any', () => {
    expect(found('')).toEqual([]);
    expect(found('const a = "//"; const b = `/*`;')).toEqual([]);
  });

  it('scans a 2,000-line file in well under 300 ms', () => {
    const lines = [
      "import { readFileSync } from 'node:fs';",
      '// Prisma returns null for soft-deleted rows (see #214).',
      "const url = 'https://example.com/api?q=' + encodeURIComponent(id); // not a comment start",
      'const re = /\\/\\/[a-z]+/g;',
      '/** Exported helper. */',
      'export const label = `user ${name} // inside a template`;',
    ];
    const source = Array.from({ length: 2000 }, (_, i) => lines[i % lines.length]).join('\n');
    const startedAt = performance.now();
    const comments = extractComments(source);
    expect(performance.now() - startedAt).toBeLessThan(300);
    expect(comments.length).toBeGreaterThan(900);
  });
});
