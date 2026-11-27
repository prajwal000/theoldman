import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  branchBase,
  currentBranch,
  defaultBranch,
  readHeadVersion,
  runGit,
} from '../../src/lib/git.js';

// Every test here starts real git processes, a dozen in some. One that takes about 1 s alone
// took over 5 s, the default limit, while the whole suite ran on a busy Windows machine.
vi.setConfig({ testTimeout: 20_000 });

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

describe('currentBranch', () => {
  it('returns the checked-out branch, even before the first commit', () => {
    const repo = initRepo();
    gitIn(repo, 'symbolic-ref', 'HEAD', 'refs/heads/feature/x');
    expect(currentBranch(repo)).toBe('feature/x');
  });

  it('returns undefined for a detached HEAD or outside a repo', () => {
    const repo = initRepo();
    commit(repo, { 'a.ts': 'a\n' });
    gitIn(repo, 'checkout', '-q', '--detach');
    expect(currentBranch(repo)).toBeUndefined();
    expect(currentBranch(dir)).toBeUndefined();
  });
});

describe('branchBase', () => {
  it('finds where the branch left main, or the remote default branch first', () => {
    const repo = initRepo();
    gitIn(repo, 'symbolic-ref', 'HEAD', 'refs/heads/main');
    commit(repo, { 'a.ts': 'a\n' });
    const mainTip = gitIn(repo, 'rev-parse', 'HEAD').trim();
    gitIn(repo, 'checkout', '-q', '-b', 'feature');
    commit(repo, { 'b.ts': 'b\n' });
    expect(branchBase(repo)).toEqual({ commit: mainTip, branch: 'main' });
    gitIn(repo, 'update-ref', 'refs/remotes/origin/develop', 'HEAD');
    gitIn(repo, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/develop');
    expect(branchBase(repo)?.branch).toBe('origin/develop');
  });

  it('skips a branch with unrelated history, and gives up without commits or candidates', () => {
    const repo = initRepo();
    gitIn(repo, 'symbolic-ref', 'HEAD', 'refs/heads/trunk');
    expect(branchBase(repo)).toBeUndefined();
    commit(repo, { 'a.ts': 'a\n' });
    expect(branchBase(repo)).toBeUndefined();
    gitIn(repo, 'checkout', '-q', '--orphan', 'main');
    commit(repo, { 'z.ts': 'z\n' });
    gitIn(repo, 'checkout', '-q', 'trunk');
    expect(branchBase(repo)).toBeUndefined();
  });
});

describe('defaultBranch', () => {
  it("reads the remote's recorded default branch", () => {
    const repo = initRepo();
    gitIn(repo, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/develop');
    gitIn(repo, 'symbolic-ref', 'refs/remotes/up.stream/HEAD', 'refs/remotes/up.stream/trunk');
    expect(defaultBranch(repo, 'origin')).toBe('develop');
    expect(defaultBranch(repo, 'up.stream')).toBe('trunk');
  });

  it('returns undefined when it was never recorded or the remote name is not a plain name', () => {
    const repo = initRepo();
    expect(defaultBranch(repo, 'origin')).toBeUndefined();
    for (const remote of ['https://github.com/a/b', '-c', '../x', 'a..b', '']) {
      expect(defaultBranch(repo, remote)).toBeUndefined();
    }
  });
});
