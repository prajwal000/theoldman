import { describe, expect, it } from 'vitest';
import { splitLines } from '../../src/lib/added-lines.js';
import type { RuleInput } from '../../src/lib/rules.js';
import { c06 } from '../../src/rules/comment-density.js';
import { runRuleOnFixtures } from '../harness.js';

runRuleOnFixtures('OLDMAN-C06', c06);

function input(content: string, added?: readonly number[]): RuleInput {
  const lines = splitLines(content).map((text, i) => ({ line: i + 1, text }));
  return {
    file: 'src/a.ts',
    content,
    addedLines: added === undefined ? lines : lines.filter(({ line }) => added.includes(line)),
  };
}

const code = (count: number): string =>
  Array.from({ length: count }, (_, i) => `export const v${String(i)} = ${String(i)};`).join('\n');
const comments = (count: number): string =>
  Array.from({ length: count }, (_, i) => `// Note ${String(i)} about the next lines.`).join('\n');

describe('OLDMAN-C06', () => {
  it('warns above 1 comment line per 5 code lines, naming both counts', () => {
    expect(c06(input(`${comments(3)}\n${code(14)}`))).toEqual([
      {
        id: 'OLDMAN-C06',
        action: 'warn',
        file: 'src/a.ts',
        line: 1,
        message:
          'This edit adds 3 comment lines for 14 lines of code (more than 1 per 5); keep only the comments that say why.',
      },
    ]);
  });

  it('allows exactly 1 comment line per 5 code lines', () => {
    expect(c06(input(`${comments(3)}\n${code(15)}`))).toEqual([]);
  });

  it('needs at least 3 comment lines, so one why-comment on a small edit is fine', () => {
    expect(c06(input(`${comments(2)}\n${code(1)}`))).toEqual([]);
  });

  it('counts only the lines this edit added', () => {
    const content = `${comments(4)}\n${code(2)}`;
    expect(c06(input(content, [5, 6]))).toEqual([]);
    expect(c06(input(content, [2, 3, 4, 5]))[0]?.line).toBe(2);
  });

  it('skips blank lines and the empty first and last lines of a JSDoc block', () => {
    // Above code that is not exported, so the JSDoc is not allow-listed TSDoc.
    const content = `/**\n * One.\n * Two.\n * Three.\n */\n\n\n${code(2).replaceAll('export ', '')}`;
    expect(c06(input(content))[0]?.message).toMatch(/adds 3 comment lines for 2 lines of code/);
  });
});
