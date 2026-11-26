import { describe, expect, it } from 'vitest';
import { splitLines } from '../../src/lib/added-lines.js';
import type { RuleInput } from '../../src/lib/rules.js';
import { checkType, runChecks } from '../../src/rules/check.js';

function input(file: string, content: string): RuleInput {
  return {
    file,
    content,
    addedLines: splitLines(content).map((text, i) => ({ line: i + 1, text })),
  };
}

const source = [
  'export function load(id: any): void {', // Q01
  '  // Added the logging', // C01
  '  console.log(id);', // Q02
  '  debugger;', // Q04
  '}',
].join('\n');

describe('runChecks', () => {
  it('runs every comment and quality rule, ordered by line then rule ID', () => {
    expect(runChecks(input('src/a.ts', source)).map((f) => `${f.id}@${String(f.line)}`)).toEqual([
      'OLDMAN-Q01@1',
      'OLDMAN-C01@2',
      'OLDMAN-Q02@3',
      'OLDMAN-Q04@4',
    ]);
  });

  it('leaves out disabled rules', () => {
    expect(
      runChecks(input('src/a.ts', source), ['OLDMAN-Q02', 'OLDMAN-C01']).map((f) => f.id),
    ).toEqual(['OLDMAN-Q01', 'OLDMAN-Q04']);
  });

  it('orders findings on the same line by rule ID', () => {
    const findings = runChecks(input('a.ts', 'const x: any = 1; debugger;'));
    expect(findings.map((f) => f.id)).toEqual(['OLDMAN-Q01', 'OLDMAN-Q04']);
  });
});

describe('checkType', () => {
  it('groups comment rules and quality rules', () => {
    const [q01, c01] = runChecks(input('src/a.ts', source));
    expect(q01 && checkType(q01)).toBe('quality');
    expect(c01 && checkType(c01)).toBe('comments');
  });
});
