import { describe, expect, it } from 'vitest';
import { splitLines } from '../../src/lib/added-lines.js';
import type { RuleInput } from '../../src/lib/rules.js';
import { c02, c03 } from '../../src/rules/comment-code.js';
import { runRuleOnFixtures } from '../harness.js';

runRuleOnFixtures('OLDMAN-C02', c02);
runRuleOnFixtures('OLDMAN-C03', c03);

function input(file: string, content: string, added?: readonly number[]): RuleInput {
  const lines = splitLines(content).map((text, i) => ({ line: i + 1, text }));
  return {
    file,
    content,
    addedLines: added === undefined ? lines : lines.filter(({ line }) => added.includes(line)),
  };
}

describe('OLDMAN-C02', () => {
  it('warns rather than asking for a fix', () => {
    const [finding] = c02(input('a.ts', '// get user\nconst user = getUser(id);\n'));
    expect(finding).toMatchObject({ id: 'OLDMAN-C02', action: 'warn', line: 1 });
    expect(finding?.message).toMatch(/explain why instead/);
  });

  it.each([
    ['plural and tense endings', '// gets the users\nconst users = getUser();'],
    ['acronyms', '// parse the XML\nconst doc = parseXMLDocument(text);'],
    ['an operator word', '// add the item\ncart.push(item);'],
  ])('matches through %s', (_name, source) => {
    expect(c02(input('a.ts', source))).toHaveLength(1);
  });

  it.each([
    ['a comment with only stop words', '// it is the one\nconst x = 1;'],
    [
      'a comment longer than eight words',
      '// get the user from the cache or the database or the network\nconst user = getUser(id);',
    ],
    ['a multi-line block comment', '/* get\n   user */\nconst user = getUser(id);'],
    ['a file that is not JS or TS', '// get user\nconst user = getUser(id);'],
  ])('leaves %s alone', (name, source) => {
    expect(c02(input(name.includes('not JS') ? 'notes.md' : 'a.ts', source))).toEqual([]);
  });

  it('checks only comments the edit added', () => {
    expect(c02(input('a.ts', '// get user\nconst user = getUser(id);\n', [2]))).toEqual([]);
  });
});

describe('OLDMAN-C03', () => {
  it('asks for a fix once per run of commented-out lines', () => {
    const source = '// const a = 1;\n// const b = 2;\nrun();\n// const c = 3;\n';
    expect(c03(input('a.ts', source)).map((f) => [f.line, f.action])).toEqual([
      [1, 'fix'],
      [4, 'fix'],
    ]);
  });

  it('starts a run on the first added line when earlier lines were already there', () => {
    const source = '// const a = 1;\n// const b = 2;\n// const c = 3;\n';
    expect(c03(input('a.ts', source, [2, 3])).map((f) => f.line)).toEqual([2]);
  });

  it.each([
    'return getUser(id)',
    'throw makeError(code)',
    'class Cache<T> {',
    'export default App;',
  ])('flags %j', (code) => {
    expect(c03(input('a.ts', `// ${code}\n`))).toHaveLength(1);
  });

  it('says how to fix it in one line', () => {
    expect(c03(input('a.ts', '// x();\n'))[0]?.message).toBe(
      'Delete the commented-out code; git keeps the old version if it is needed again.',
    );
  });
});
