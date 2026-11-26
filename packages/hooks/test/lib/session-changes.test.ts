import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dirtyFiles, recordBaseline, sessionChanges } from '../../src/lib/session-changes.js';
import { readSessionJson, recordTouchedFile } from '../../src/lib/state.js';

let repo: string;
beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'theoldman-changes-'));
  git('init', '-q');
  write({ '.gitignore': '.theoldman/\nignored.log\n', 'a.ts': 'a\n', 'b.ts': 'b\n' });
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
});
afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

function git(...args: string[]): void {
  execFileSync(
    'git',
    ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args],
    { cwd: repo, stdio: 'ignore' },
  );
}

function write(files: Record<string, string>): void {
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(join(repo, name, '..'), { recursive: true });
    writeFileSync(join(repo, name), content);
  }
}

/** Moves a file's modification time, as a later edit would, whatever the clock resolution. */
function touchLater(name: string): void {
  const later = new Date(Date.now() + 60_000);
  utimesSync(join(repo, name), later, later);
}

describe('dirtyFiles', () => {
  it('lists modified, deleted and untracked files, but not ignored ones', () => {
    write({ 'a.ts': 'a2\n', 'new.ts': 'n\n', 'ignored.log': 'x\n' });
    unlinkSync(join(repo, 'b.ts'));
    const files = dirtyFiles(repo) ?? {};
    expect(Object.keys(files).sort()).toEqual(['a.ts', 'b.ts', 'new.ts']);
    expect(files['b.ts']).toBe('missing');
    expect(files['a.ts']).toMatch(/^3:\d/);
  });

  it('gives up above the limit and outside a repo', () => {
    write({ 'x.ts': 'x\n', 'y.ts': 'y\n' });
    expect(dirtyFiles(repo, 1)).toBeUndefined();
    const loose = mkdtempSync(join(tmpdir(), 'theoldman-loose-'));
    try {
      expect(dirtyFiles(loose)).toBeUndefined();
    } finally {
      rmSync(loose, { recursive: true, force: true });
    }
  });
});

describe('sessionChanges', () => {
  it('counts touched files and files changed since the baseline, not earlier uncommitted work', () => {
    write({ 'a.ts': 'user edit before the session\n', 'notes.txt': 'user\n' });
    recordBaseline(repo, 's1');
    write({ 'b.ts': 'changed by a shell command\n', 'gen/out.ts': 'generated\n' });
    recordTouchedFile(repo, 's1', 'src/written.ts');
    expect(sessionChanges(repo, 's1').sort()).toEqual(['b.ts', 'gen/out.ts', 'src/written.ts']);
    touchLater('notes.txt');
    expect(sessionChanges(repo, 's1')).toContain('notes.txt');
  });

  it('keeps the first baseline on later session starts', () => {
    recordBaseline(repo, 's1');
    write({ 'a.ts': 'changed\n' });
    recordBaseline(repo, 's1');
    expect(sessionChanges(repo, 's1')).toEqual(['a.ts']);
  });

  it('uses touched files only without a baseline, and drops paths outside the project', () => {
    write({ 'a.ts': 'changed by a shell command\n' });
    for (const file of ['src/x.ts', '/etc/hosts', 'c:/other/y.ts', '../z.ts']) {
      recordTouchedFile(repo, 's1', file);
    }
    expect(sessionChanges(repo, 's1')).toEqual(['src/x.ts']);
  });

  it('records no baseline outside a repo, and still reports touched files', () => {
    const loose = mkdtempSync(join(tmpdir(), 'theoldman-loose-'));
    try {
      recordBaseline(loose, 's1');
      expect(readSessionJson(loose, 's1', 'baseline.json')).toBeNull();
      recordTouchedFile(loose, 's1', 'a.ts');
      expect(sessionChanges(loose, 's1')).toEqual(['a.ts']);
    } finally {
      rmSync(loose, { recursive: true, force: true });
    }
  });
});
