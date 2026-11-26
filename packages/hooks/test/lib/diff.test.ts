import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newFileDiff, parseDiff, workingTreeDiff } from '../../src/lib/diff.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'theoldman-diff-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): void {
  execFileSync(
    'git',
    ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args],
    { cwd, stdio: 'ignore' },
  );
}

function write(repo: string, files: Record<string, string | Buffer>): void {
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(join(repo, name, '..'), { recursive: true });
    writeFileSync(join(repo, name), content);
  }
}

function repoWith(files: Record<string, string>): string {
  git(dir, 'init', '-q');
  write(dir, files);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  return dir;
}

describe('workingTreeDiff', () => {
  it('shows staged, unstaged, deleted and untracked changes against HEAD', () => {
    const repo = repoWith({ 'a.ts': 'one\ntwo\n', 'gone.ts': 'x\n', 'staged.ts': 's\n' });
    write(repo, { 'a.ts': 'one\nTWO\nthree\n', 'staged.ts': 's\nt\n', 'src/new file.ts': 'n\n' });
    git(repo, 'add', '--', 'staged.ts');
    unlinkSync(join(repo, 'gone.ts'));
    const files = parseDiff(workingTreeDiff(repo));
    expect(files.map(({ path, status }) => `${status} ${path}`).sort()).toEqual([
      'added src/new file.ts',
      'deleted gone.ts',
      'modified a.ts',
      'modified staged.ts',
    ]);
    expect(files.find((file) => file.path === 'a.ts')?.addedLines).toEqual([
      { line: 2, text: 'TWO' },
      { line: 3, text: 'three' },
    ]);
    expect(files.find((file) => file.path === 'src/new file.ts')?.addedLines).toEqual([
      { line: 1, text: 'n' },
    ]);
  });

  it('leaves out ignored files, and lists binary or huge untracked files without content', () => {
    const repo = repoWith({ '.gitignore': 'dist/\n' });
    write(repo, {
      'dist/out.js': 'x\n',
      'logo.png': Buffer.from([0x89, 0x50, 0, 1]),
      'big.txt': 'x'.repeat(1024 * 1024 + 1),
      'empty.ts': '',
    });
    const diff = workingTreeDiff(repo);
    expect(diff).not.toContain('dist/out.js');
    expect(diff).toContain('Binary files /dev/null and b/logo.png differ');
    expect(diff).toContain('Binary files /dev/null and b/big.txt differ');
    expect(
      parseDiff(diff)
        .map(({ path, status }) => `${status} ${path}`)
        .sort(),
    ).toEqual(['added big.txt', 'added empty.ts', 'added logo.png']);
  });

  it('gives paths relative to a subdirectory and only its changes', () => {
    const repo = repoWith({ 'apps/web/a.ts': 'a\n', 'root.ts': 'r\n' });
    write(repo, { 'apps/web/a.ts': 'a\nb\n', 'root.ts': 'r\ns\n', 'apps/web/new.ts': 'n\n' });
    const files = parseDiff(workingTreeDiff(join(repo, 'apps', 'web')));
    expect(files.map((file) => file.path).sort()).toEqual(['a.ts', 'new.ts']);
  });

  it('treats staged and untracked files as new before the first commit', () => {
    git(dir, 'init', '-q');
    write(dir, { 'staged.ts': 's\n', 'loose.ts': 'l\n' });
    git(dir, 'add', '--', 'staged.ts');
    const files = parseDiff(workingTreeDiff(dir));
    expect(files.map(({ path, status }) => `${status} ${path}`).sort()).toEqual([
      'added loose.ts',
      'added staged.ts',
    ]);
  });

  it('runs no external diff or textconv program from the repo config', () => {
    const repo = repoWith({ 'a.txt': 'a\n', '.gitattributes': '*.txt diff=evil\n' });
    git(repo, 'config', 'diff.external', "node -e \"require('fs').writeFileSync('ext-ran','')\"");
    git(
      repo,
      'config',
      'diff.evil.textconv',
      "node -e \"require('fs').writeFileSync('tc-ran','')\"",
    );
    git(repo, 'config', 'diff.noprefix', 'true');
    write(repo, { 'a.txt': 'a\nb\n' });
    const files = parseDiff(workingTreeDiff(repo));
    expect(files.map((file) => file.path)).toEqual(['a.txt']);
    expect(existsSync(join(repo, 'ext-ran'))).toBe(false);
    expect(existsSync(join(repo, 'tc-ran'))).toBe(false);
  });

  it('throws outside a git repository', () => {
    expect(() => workingTreeDiff(dir)).toThrow();
  });

  it('skips an untracked file that is gone by the time it is read', () => {
    expect(newFileDiff(dir, 'gone.ts')).toBe('');
  });
});

describe('parseDiff', () => {
  it('reads quoted paths, keeps `+++` content inside hunks, and skips no-newline markers', () => {
    const diff = [
      'diff --git "a/caf\\303\\251 \\"x\\".ts" "b/caf\\303\\251 \\"x\\".ts"',
      'index 1..2 100644',
      '--- "a/caf\\303\\251 \\"x\\".ts"',
      '+++ "b/caf\\303\\251 \\"x\\".ts"',
      '@@ -1,2 +1,3 @@',
      ' keep',
      '-old',
      '+++ b/not-a-header',
      '+--- a/not-either',
      '\\ No newline at end of file',
      'diff --git a/tab.ts b/tab.ts',
      'deleted file mode 100644',
      '--- a/tab.ts\t',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-x',
    ].join('\n');
    expect(parseDiff(diff)).toEqual([
      {
        path: 'café "x".ts',
        status: 'modified',
        addedLines: [
          { line: 2, text: '++ b/not-a-header' },
          { line: 3, text: '--- a/not-either' },
        ],
      },
      { path: 'tab.ts', status: 'deleted', addedLines: [] },
    ]);
  });

  it('names a binary file from its diff header, and ignores text before the first file', () => {
    const diff =
      'warning: x\ndiff --git a/my logo.png b/my logo.png\nnew file mode 100644\nBinary files /dev/null and b/my logo.png differ\n';
    expect(parseDiff(diff)).toEqual([{ path: 'my logo.png', status: 'added', addedLines: [] }]);
    expect(parseDiff('')).toEqual([]);
  });

  it('unescapes tabs, newlines and backslashes in quoted paths', () => {
    const diff =
      'diff --git "a/a\\tb\\\\c\\n" "b/a\\tb\\\\c\\n"\n--- "a/a\\tb\\\\c\\n"\n+++ "b/a\\tb\\\\c\\n"\n';
    expect(parseDiff(diff)[0]?.path).toBe('a\tb\\c\n');
  });
});
