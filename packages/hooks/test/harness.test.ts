import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Finding, Rule } from '../src/lib/rules.js';
import {
  fixtureProblems,
  FIXTURES_ROOT,
  loadFixtures,
  parseFixture,
  runRuleOnFixtures,
} from './harness.js';

const samples = fileURLToPath(new URL('./harness-samples/', import.meta.url));

/** Dummy rule: every added line containing BAD is a finding. */
const dummy: Rule = ({ file, addedLines }) =>
  addedLines
    .filter(({ text }) => text.includes('BAD'))
    .map(({ line }): Finding => ({
      id: 'OLDMAN-T01',
      action: 'fix',
      file,
      line,
      message: 'Says BAD.',
    }));

runRuleOnFixtures('OLDMAN-T01', dummy, samples);

describe('loadFixtures', () => {
  it('loads bad and good files, nested ones included, with sorted expectations', () => {
    const fixtures = loadFixtures('OLDMAN-T01', samples);
    expect(fixtures.map((f) => [f.kind, f.file, f.expected])).toEqual([
      ['bad', 'nested/two.sh', ['OLDMAN-T01@3']],
      ['bad', 'one.ts', ['OLDMAN-T01@3', 'OLDMAN-T01@5']],
      ['good', 'clean.ts', []],
    ]);
  });

  it('defaults to the fixtures folder next to the harness', () => {
    expect(FIXTURES_ROOT.replaceAll('\\', '/')).toMatch(/packages\/hooks\/test\/fixtures\/$/);
  });

  describe('with an incomplete rule folder', () => {
    let root: string;
    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), 'theoldman-harness-'));
    });
    afterEach(() => {
      rmSync(root, { recursive: true, force: true });
    });

    function write(path: string, text: string): void {
      const file = join(root, path);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, text);
    }

    it('fails when the rule has no fixtures at all', () => {
      expect(() => loadFixtures('OLDMAN-T01', root)).toThrow('needs at least one bad fixture');
    });

    it('fails when the rule has bad fixtures but no good ones', () => {
      write('OLDMAN-T01/bad/a.ts', '// expect: OLDMAN-T01@2\nBAD\n');
      expect(() => loadFixtures('OLDMAN-T01', root)).toThrow('needs at least one good fixture');
    });
  });
});

describe('parseFixture', () => {
  it('blanks expect lines but keeps the line numbers', () => {
    const fixture = parseFixture('OLDMAN-T01', 'bad', 'a.ts', '// expect: OLDMAN-T01@2\nBAD\n');
    expect(fixture.input).toEqual({
      file: 'a.ts',
      content: '\nBAD\n',
      addedLines: [
        { line: 1, text: '' },
        { line: 2, text: 'BAD' },
      ],
    });
  });

  it.each([
    ['//', '// expect: OLDMAN-T01@2'],
    ['#', '# expect: OLDMAN-T01@2'],
    ['--', '-- expect: OLDMAN-T01@2'],
    ['/* */', '/* expect: OLDMAN-T01@2 */'],
    ['indented', '   // expect:OLDMAN-T01@2'],
  ])('reads a %s header', (_style, header) => {
    expect(parseFixture('OLDMAN-T01', 'bad', 'a', `${header}\nBAD\n`).expected).toEqual([
      'OLDMAN-T01@2',
    ]);
  });

  it('reads several headers and several expectations per line, with CRLF', () => {
    const text =
      '// expect: OLDMAN-T01@4 OLDMAN-T01@3\r\n# expect: OLDMAN-T01@10,OLDMAN-T01@5\r\nx\r\n';
    expect(parseFixture('OLDMAN-T01', 'bad', 'a', text).expected).toEqual([
      'OLDMAN-T01@10',
      'OLDMAN-T01@3',
      'OLDMAN-T01@4',
      'OLDMAN-T01@5',
    ]);
  });

  it.each([
    ['a malformed expectation', 'bad', '// expect: OLDMAN-T01:3', '"OLDMAN-T01:3" is not ID@line'],
    ['line 0', 'bad', '// expect: OLDMAN-T01@0', '"OLDMAN-T01@0" is not ID@line'],
    ['another rule', 'bad', '// expect: OLDMAN-C01@1', 'expects OLDMAN-C01@1, not OLDMAN-T01'],
    ['a bad file with no expectation', 'bad', 'BAD', 'declares no expected findings'],
    [
      'a good file with an expectation',
      'good',
      '// expect: OLDMAN-T01@1',
      'cannot expect findings',
    ],
  ] as const)('rejects %s', (_name, kind, text, message) => {
    expect(() => parseFixture('OLDMAN-T01', kind, 'a.ts', text)).toThrow(message);
  });
});

describe('fixtureProblems', () => {
  const fixture = parseFixture(
    'OLDMAN-T01',
    'bad',
    'a.ts',
    '// expect: OLDMAN-T01@2, OLDMAN-T01@3\nBAD\nBAD\n',
  );
  const finding = (line: number, extra: Partial<Finding> = {}): Finding => ({
    id: 'OLDMAN-T01',
    action: 'fix',
    file: 'a.ts',
    line,
    message: 'Says BAD.',
    ...extra,
  });

  it('is empty when the findings match', () => {
    expect(fixtureProblems('OLDMAN-T01', dummy, fixture)).toEqual([]);
  });

  it('ignores findings for other rules', () => {
    const noisy: Rule = (input) => [...dummy(input), finding(1, { id: 'OLDMAN-C01' })];
    expect(fixtureProblems('OLDMAN-T01', noisy, fixture)).toEqual([]);
  });

  it('reports missing and unexpected findings', () => {
    const wrong: Rule = () => [finding(2), finding(4)];
    expect(fixtureProblems('OLDMAN-T01', wrong, fixture)).toEqual([
      'missing OLDMAN-T01@3',
      'unexpected OLDMAN-T01@4',
    ]);
  });

  it('reports a finding that names another file or has no message', () => {
    const sloppy: Rule = () => [finding(2, { file: 'other.ts' }), finding(3, { message: ' ' })];
    expect(fixtureProblems('OLDMAN-T01', sloppy, fixture)).toEqual([
      'OLDMAN-T01@2 names file "other.ts"',
      'OLDMAN-T01@3 has no message',
    ]);
  });

  it('fails a good fixture on any finding for its rule', () => {
    const good = parseFixture('OLDMAN-T01', 'good', 'b.ts', 'fine\n');
    expect(fixtureProblems('OLDMAN-T01', () => [finding(1, { file: 'b.ts' })], good)).toEqual([
      'unexpected OLDMAN-T01@1',
    ]);
  });
});
