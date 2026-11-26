import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { splitLines } from '../../src/lib/added-lines.js';
import type { RuleInput } from '../../src/lib/rules.js';
import { addedCommentLines, c01, c04, c05 } from '../../src/rules/comments.js';
import { FIXTURES_ROOT, runRuleOnFixtures } from '../harness.js';

runRuleOnFixtures('OLDMAN-C01', c01);
runRuleOnFixtures('OLDMAN-C04', c04);
runRuleOnFixtures('OLDMAN-C05', c05);

/** Rule input for `content` where only `added` line numbers were added by the edit. */
function input(file: string, content: string, added?: readonly number[]): RuleInput {
  const lines = splitLines(content).map((text, i) => ({ line: i + 1, text }));
  return {
    file,
    content,
    addedLines: added === undefined ? lines : lines.filter(({ line }) => added.includes(line)),
  };
}

describe('addedCommentLines', () => {
  const source = 'const a = 1; // one\n/*\n * two\n *\n * three\n */\n// four\n';

  it('gives each non-empty comment line with its line in the file', () => {
    expect(addedCommentLines(input('a.ts', source))).toEqual([
      { line: 1, text: 'one' },
      { line: 3, text: 'two' },
      { line: 5, text: 'three' },
      { line: 7, text: 'four' },
    ]);
  });

  it('keeps only lines the edit added', () => {
    expect(addedCommentLines(input('a.ts', source, [5, 7]))).toEqual([
      { line: 5, text: 'three' },
      { line: 7, text: 'four' },
    ]);
  });

  it('reads nothing from files that are not JS or TS', () => {
    expect(addedCommentLines(input('notes.md', '// Added a note'))).toEqual([]);
  });
});

describe('the jsx-url.tsx fixtures', () => {
  it.each([
    ['OLDMAN-C01', c01],
    ['OLDMAN-C04', c04],
    ['OLDMAN-C05', c05],
  ] as const)('%s would flag the URL text if it were read as a comment', (id, rule) => {
    const content = readFileSync(join(FIXTURES_ROOT, id, 'good', 'jsx-url.tsx'), 'utf8');
    expect(rule(input('jsx-url.tsx', content))).toEqual([]);
    expect(rule(input('jsx-url.ts', content)).length).toBeGreaterThan(0);
  });
});

describe('comment rules', () => {
  it('flag only comments on added lines', () => {
    const content = '// Added retry\n// TODO later\n// ======\nconst x = 1;\n';
    expect(c01(input('a.ts', content, [4]))).toEqual([]);
    expect(c04(input('a.ts', content, [2])).map((f) => f.line)).toEqual([2]);
  });

  it('report a Fix with a one-line message', () => {
    for (const rule of [c01, c04, c05]) {
      const [finding] = rule(input('src/a.ts', '// Added the cache\n// TODO: x\n// ======\n'));
      expect(finding).toMatchObject({ action: 'fix', file: 'src/a.ts' });
      expect(finding?.message).not.toContain('\n');
    }
    expect(c01(input('a.ts', '// Added the cache'))[0]?.message).toMatch(
      /^Move change notes to the commit message/,
    );
  });
});
