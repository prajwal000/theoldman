import { describe, expect, it } from 'vitest';
import { splitLines } from '../../src/lib/added-lines.js';
import type { RuleInput } from '../../src/lib/rules.js';
import { q01, q02, q03, q04 } from '../../src/rules/quality.js';
import { runRuleOnFixtures } from '../harness.js';

runRuleOnFixtures('OLDMAN-Q01', q01);
runRuleOnFixtures('OLDMAN-Q02', q02);
runRuleOnFixtures('OLDMAN-Q03', q03);
runRuleOnFixtures('OLDMAN-Q04', q04);

function input(file: string, content: string, added?: readonly number[]): RuleInput {
  const lines = splitLines(content).map((text, i) => ({ line: i + 1, text }));
  return {
    file,
    content,
    addedLines: added === undefined ? lines : lines.filter(({ line }) => added.includes(line)),
  };
}

describe('OLDMAN-Q01', () => {
  it.each(['a.ts', 'A.TSX', 'src/b.mts', 'c.cts'])('checks TypeScript file %s', (file) => {
    expect(q01(input(file, 'let x: any;'))).toHaveLength(1);
  });

  it.each(['a.js', 'b.jsx', 'c.mjs', 'notes.md'])('skips %s', (file) => {
    expect(q01(input(file, 'let x: any;'))).toEqual([]);
  });
});

describe('OLDMAN-Q02', () => {
  it.each([
    'C:\\repo\\scripts\\build.ts',
    'C:/repo/bin/run.mjs',
    '/c/repo/cli/main.ts',
    'src\\__tests__\\a.ts',
    'packages\\web\\test\\setup.ts',
    'src\\app.spec.tsx',
    'src/App.test.js',
  ])('allows console.log in %s', (file) => {
    expect(q02(input(file, "console.log('x');"))).toEqual([]);
  });

  it.each(['C:\\repo\\src\\app.ts', 'src/scriptsLoader.ts', 'src/testing.ts', 'lib/binary.js'])(
    'flags console.log in %s',
    (file) => {
      expect(q02(input(file, "console.log('x');"))).toHaveLength(1);
    },
  );
});

describe('OLDMAN-Q03', () => {
  it('reports the line of catch for a block that spans lines, if any of them was added', () => {
    const source = 'try {\n  run();\n} catch (e) {\n\n}\n';
    expect(q03(input('a.ts', source, [5])).map((f) => f.line)).toEqual([3]);
    expect(q03(input('a.ts', source, [1, 2]))).toEqual([]);
  });

  it('skips files that are not JS or TS', () => {
    expect(q03(input('notes.md', 'try {} catch {}'))).toEqual([]);
  });
});

describe('quality rules', () => {
  it('flag only added lines and never text in strings or comments', () => {
    const source = "debugger;\nconst s = 'debugger;'; // debugger;\n";
    expect(q04(input('a.ts', source, [2]))).toEqual([]);
    expect(q04(input('a.ts', source)).map((f) => f.line)).toEqual([1]);
  });

  it('report a Fix with a one-line message', () => {
    const findings = [
      ...q01(input('a.ts', 'let x: any;')),
      ...q02(input('a.ts', 'console.log(1);')),
      ...q03(input('a.ts', 'try { a(); } catch {}')),
      ...q04(input('a.ts', 'debugger;')),
    ];
    expect(findings.map((f) => [f.id, f.action])).toEqual([
      ['OLDMAN-Q01', 'fix'],
      ['OLDMAN-Q02', 'fix'],
      ['OLDMAN-Q03', 'fix'],
      ['OLDMAN-Q04', 'fix'],
    ]);
    for (const finding of findings) expect(finding.message).not.toContain('\n');
  });
});
