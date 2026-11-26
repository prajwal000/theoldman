import { describe, expect, it } from 'vitest';
import { maskJs } from '../../src/lib/code-mask.js';
import { scanJs } from '../../src/lib/js-scan.js';

describe('maskJs', () => {
  it('blanks strings, template text, regex literals and comments, keeping offsets and lines', () => {
    const source = "const a = 'x // y'; // note\nconst b = `t ${a} u`; /* c\nd */ const r = /re/g;";
    const masked = maskJs(source, 'a.ts');
    expect(masked).toHaveLength(source.length);
    const blank = (count: number): string => ' '.repeat(count);
    expect(masked.split('\n')).toEqual([
      `const a = ${blank("'x // y'".length)}; ${blank('// note'.length)}`,
      `const b = ${blank('`t ${'.length)}a${blank('} u`'.length)}; ${blank('/* c'.length)}`,
      `${blank('d */'.length)} const r = ${blank('/re/g'.length)};`,
    ]);
  });

  it('keeps comments when asked', () => {
    expect(maskJs("catch { /* why */ } 'x'", 'a.ts', { keepComments: true })).toBe(
      'catch { /* why */ }    ',
    );
  });

  it('keeps code inside template expressions, also nested ones', () => {
    expect(maskJs('`a ${f(`b ${g()}`)} c`')).toBe('     f(     g()  )    ');
  });

  it('blanks an unterminated template to the end and leaves a shebang alone', () => {
    expect(maskJs('x(); `open')).toBe('x();      ');
    expect(maskJs('#!/usr/bin/env node\nrun();')).toBe('#!/usr/bin/env node\nrun();');
  });
});

describe('scanJs', () => {
  it('returns spans in source order with their kinds', () => {
    expect(scanJs("f('s', /r/); // c", 'a.ts').map((span) => span.kind)).toEqual([
      'string',
      'regex',
      'line-comment',
    ]);
  });
});
