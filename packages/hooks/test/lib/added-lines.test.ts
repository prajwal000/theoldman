import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  addedLinesForEdit,
  addedLinesForWrite,
  diffAddedLines,
  splitLines,
} from '../../src/lib/added-lines.js';

const lines = (...items: string[]): string => items.map((item) => `${item}\n`).join('');

describe('splitLines', () => {
  it.each([
    ['', []],
    ['a', ['a']],
    ['a\n', ['a']],
    ['a\r\nb\r\n', ['a', 'b']],
    ['a\n\nb', ['a', '', 'b']],
  ])('%j', (text, expected) => {
    expect(splitLines(text)).toEqual(expected);
  });
});

describe('diffAddedLines', () => {
  it('finds nothing when the content is unchanged', () => {
    expect(diffAddedLines(lines('a', 'b'), lines('a', 'b'))).toEqual([]);
  });

  it('counts every line as added when there was no old content', () => {
    expect(diffAddedLines('', lines('a', 'b'))).toEqual([
      { line: 1, text: 'a' },
      { line: 2, text: 'b' },
    ]);
  });

  it('finds inserted, replaced and appended lines with their new line numbers', () => {
    const before = lines('one', 'two', 'three', 'four');
    const after = lines('one', 'inserted', 'two', 'THREE', 'four', 'appended');
    expect(diffAddedLines(before, after)).toEqual([
      { line: 2, text: 'inserted' },
      { line: 4, text: 'THREE' },
      { line: 6, text: 'appended' },
    ]);
  });

  it('finds nothing for a pure deletion', () => {
    expect(diffAddedLines(lines('a', 'b', 'c'), lines('a', 'c'))).toEqual([]);
  });

  it('handles repeated lines and moved blocks', () => {
    expect(diffAddedLines(lines('x', 'a', 'x'), lines('x', 'x', 'a', 'x'))).toEqual([
      { line: 2, text: 'x' },
    ]);
    expect(diffAddedLines(lines('a', 'b', 'c'), lines('c', 'a', 'b'))).toEqual([
      { line: 1, text: 'c' },
    ]);
  });

  it('gives the same result for CRLF and LF content', () => {
    const before = 'a\r\nb\r\nc\r\n';
    expect(diffAddedLines(before, 'a\nB\nc\n')).toEqual([{ line: 2, text: 'B' }]);
    expect(diffAddedLines(before, 'a\r\nB\r\nc\r\n')).toEqual([{ line: 2, text: 'B' }]);
    expect(diffAddedLines('a\nb\n', 'a\r\nb\r\n')).toEqual([]);
  });

  it('falls back to counting lines when the changed region is too large for the table', () => {
    const before = Array.from({ length: 2400 }, (_, i) => `old ${String(i)}`);
    // No common first or last line, so the whole 2,400 x 2,403 region is compared: over the limit.
    const after = ['first', ...before.toReversed(), 'new', 'old 0'];
    // Reordered old lines are not added; "first", "new" and the extra copy of "old 0" are.
    expect(diffAddedLines(lines(...before), lines(...after))).toEqual([
      { line: 1, text: 'first' },
      { line: 2402, text: 'new' },
      { line: 2403, text: 'old 0' },
    ]);
  });

  describe('on a 2,000-line file', () => {
    const before = Array.from(
      { length: 2000 },
      (_, i) => `const value${String(i)} = ${String(i)};`,
    );
    const block = before.slice(300, 1700);
    // The slowest change the exact diff still takes: 1,400 shared lines in a different order.
    const swappedBlock = [
      ...before.slice(0, 300),
      ...block.slice(700),
      ...block.slice(0, 700),
      ...before.slice(1700),
    ];

    it.each([
      ['a scattered edit', before.map((l, i) => (i % 7 === 0 ? `${l} // changed` : l)), 286],
      ['a full rewrite', before.map((l) => `${l} // rewritten`), 2000],
      ['every line reordered', before.toReversed(), 0],
      ['a reordered 1,400-line block', swappedBlock, 700],
    ])('diffs %s in under 300 ms', (_name, after, addedCount) => {
      const startedAt = performance.now();
      const added = diffAddedLines(lines(...before), lines(...after));
      const elapsed = performance.now() - startedAt;
      expect(added).toHaveLength(addedCount);
      expect(elapsed).toBeLessThan(300);
    });
  });
});

describe('addedLinesForEdit', () => {
  const edit = {
    file_path: 'a.ts',
    old_string: 'const a = 1;\nconst b = 2;',
    new_string: 'const a = 1;\nconst b = 20; // Updated\nconst c = 3;',
  };

  it('takes added lines from old_string and new_string', () => {
    expect(addedLinesForEdit(edit)).toEqual([
      { line: 2, text: 'const b = 20; // Updated' },
      { line: 3, text: 'const c = 3;' },
    ]);
  });

  it('uses file line numbers and whole lines when given the edited file', () => {
    const file = ['import x;', '', 'const a = 1;', 'const b = 20; // Updated', 'const c = 3;', ''];
    expect(addedLinesForEdit(edit, file.join('\r\n'))).toEqual([
      { line: 4, text: 'const b = 20; // Updated' },
      { line: 5, text: 'const c = 3;' },
    ]);
  });

  it('reports the whole file line for an edit inside a line', () => {
    const partial = { file_path: 'a.ts', old_string: 'b = 2', new_string: 'b = 20' };
    expect(addedLinesForEdit(partial, 'const a = 1;\nexport const b = 20;\n')).toEqual([
      { line: 2, text: 'export const b = 20;' },
    ]);
  });

  it('falls back to new_string line numbers when it is not found in the file', () => {
    expect(addedLinesForEdit(edit, 'something else entirely\n')).toEqual(addedLinesForEdit(edit));
  });

  it('finds nothing for a pure deletion', () => {
    const deletion = { file_path: 'a.ts', old_string: 'a\nb\n', new_string: 'a\n' };
    expect(addedLinesForEdit(deletion, 'a\n')).toEqual([]);
  });
});

describe('addedLinesForWrite', () => {
  const dir = mkdtempSync(join(tmpdir(), 'theoldman-added-'));
  const repo = join(dir, 'repo');
  mkdirSync(repo);
  const git = (...args: string[]): void => {
    execFileSync(
      'git',
      [
        '-c',
        'user.name=test',
        '-c',
        'user.email=test@example.com',
        '-c',
        'commit.gpgsign=false',
        ...args,
      ],
      { cwd: repo, stdio: 'ignore' },
    );
  };
  git('init', '-q');
  writeFileSync(join(repo, 'tracked.ts'), lines('a', 'b', 'c'));
  git('add', '--', 'tracked.ts');
  git('commit', '-q', '-m', 'test');

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('diffs a tracked file against HEAD', () => {
    expect(addedLinesForWrite(join(repo, 'tracked.ts'), lines('a', 'B', 'c', 'd'))).toEqual([
      { line: 2, text: 'B' },
      { line: 4, text: 'd' },
    ]);
  });

  it('ignores a change of line endings against HEAD', () => {
    expect(addedLinesForWrite(join(repo, 'tracked.ts'), 'a\r\nb\r\nc\r\n')).toEqual([]);
  });

  it('counts every line of an untracked file as added', () => {
    expect(addedLinesForWrite(join(repo, 'untracked.ts'), lines('a', 'b'))).toEqual([
      { line: 1, text: 'a' },
      { line: 2, text: 'b' },
    ]);
  });

  it('counts every line as added outside a git repo', () => {
    expect(addedLinesForWrite(join(dir, 'loose.ts'), lines('a'))).toEqual([{ line: 1, text: 'a' }]);
  });
});
