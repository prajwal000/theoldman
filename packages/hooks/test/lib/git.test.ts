import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readHeadVersion, runGit } from '../../src/lib/git.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'theoldman-git-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function gitIn(cwd: string, ...args: string[]): string {
  return execFileSync(
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
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  );
}

function initRepo(): string {
  const repo = join(dir, 'repo');
  mkdirSync(repo);
  gitIn(repo, 'init', '-q');
  return repo;
}

function commit(repo: string, files: Record<string, string>): void {
  for (const [name, content] of Object.entries(files)) {
    const file = join(repo, name);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, content);
    gitIn(repo, 'add', '--', name);
  }
  gitIn(repo, 'commit', '-q', '-m', 'test');
}

describe('readHeadVersion', () => {
  it('returns the committed content, not the working copy', () => {
    const repo = initRepo();
    commit(repo, { 'a.ts': 'committed\n' });
    writeFileSync(join(repo, 'a.ts'), 'edited\n');
    expect(readHeadVersion(join(repo, 'a.ts'))).toBe('committed\n');
  });

  it('finds files in subdirectories and names that look like options', () => {
    const repo = initRepo();
    commit(repo, { 'src/deep/b.ts': 'b\n', '-rf.ts': 'dash\n' });
    expect(readHeadVersion(join(repo, 'src', 'deep', 'b.ts'))).toBe('b\n');
    expect(readHeadVersion(join(repo, '-rf.ts'))).toBe('dash\n');
  });

  it('returns undefined for an untracked or only staged file', () => {
    const repo = initRepo();
    commit(repo, { 'a.ts': 'a\n' });
    writeFileSync(join(repo, 'new.ts'), 'new\n');
    expect(readHeadVersion(join(repo, 'new.ts'))).toBeUndefined();
    gitIn(repo, 'add', '--', 'new.ts');
    expect(readHeadVersion(join(repo, 'new.ts'))).toBeUndefined();
  });

  it('returns undefined in a repo with no commits', () => {
    const repo = initRepo();
    writeFileSync(join(repo, 'a.ts'), 'a\n');
    expect(readHeadVersion(join(repo, 'a.ts'))).toBeUndefined();
  });

  it('returns undefined outside a repo and for a missing directory', () => {
    writeFileSync(join(dir, 'loose.ts'), 'x\n');
    expect(readHeadVersion(join(dir, 'loose.ts'))).toBeUndefined();
    expect(readHeadVersion(join(dir, 'missing', 'a.ts'))).toBeUndefined();
  });
});

describe('runGit', () => {
  it('neutralises a hostile core.fsmonitor in the repo config', () => {
    const repo = initRepo();
    commit(repo, { 'a.ts': 'a\n' });
    gitIn(repo, 'config', 'core.fsmonitor', 'echo pwned > fsmonitor-ran.txt');
    const marker = join(repo, 'fsmonitor-ran.txt');

    // Control: plain git status runs the configured command, so the hostile config is live.
    gitIn(repo, 'status', '--porcelain');
    expect(existsSync(marker)).toBe(true);
    rmSync(marker);

    runGit(repo, ['status', '--porcelain']);
    expect(readHeadVersion(join(repo, 'a.ts'))).toBe('a\n');
    expect(existsSync(marker)).toBe(false);
  });

  it.each(['fetch', 'pull', 'push', 'clone', 'ls-remote', 'remote'])(
    'refuses the network subcommand %s',
    (subcommand) => {
      expect(() => runGit(dir, [subcommand])).toThrow('reaches the network');
    },
  );

  it('throws when git fails', () => {
    expect(() => runGit(dir, ['rev-parse', '--show-toplevel'])).toThrow();
    expect(() => runGit(dir, [])).toThrow();
  });
});
