import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addRound, getRounds, isPaused, setPaused, stateDir } from '../../src/lib/state.js';

let project: string;
let outside: string;
beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'theoldman-state-'));
  outside = mkdtempSync(join(tmpdir(), 'theoldman-outside-'));
});
afterEach(() => {
  rmSync(project, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join('/'));
}

describe('paused flag', () => {
  it('is off by default and toggles with a file in .theoldman/state', () => {
    expect(isPaused(project)).toBe(false);
    setPaused(project, true);
    expect(isPaused(project)).toBe(true);
    expect(filesUnder(project)).toEqual(['.theoldman/state/paused']);
    setPaused(project, false);
    expect(isPaused(project)).toBe(false);
  });

  it('can be cleared when it was never set', () => {
    setPaused(project, false);
    expect(isPaused(project)).toBe(false);
  });
});

describe('feedback rounds', () => {
  it('start at 0 before any state exists', () => {
    expect(getRounds(project, 'session-1', 'comments')).toBe(0);
    expect(existsSync(stateDir(project))).toBe(false);
  });

  it('count per check type and per session', () => {
    expect(addRound(project, 'session-1', 'comments')).toBe(1);
    expect(addRound(project, 'session-1', 'comments')).toBe(2);
    expect(addRound(project, 'session-1', 'quality')).toBe(1);
    expect(addRound(project, 'session-2', 'comments')).toBe(1);
    expect(getRounds(project, 'session-1', 'comments')).toBe(2);
    expect(getRounds(project, 'session-1', 'quality')).toBe(1);
    expect(getRounds(project, 'session-2', 'comments')).toBe(1);
    expect(getRounds(project, 'session-2', 'docs')).toBe(0);
  });

  it('ignore inherited object keys used as check names', () => {
    expect(getRounds(project, 'session-1', 'constructor')).toBe(0);
    expect(addRound(project, 'session-1', 'constructor')).toBe(1);
  });

  it('reset when the rounds file is corrupt and drop invalid counts', () => {
    const dir = join(stateDir(project), 'session-1');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'rounds.json'), 'not json');
    expect(getRounds(project, 'session-1', 'comments')).toBe(0);
    expect(addRound(project, 'session-1', 'comments')).toBe(1);

    writeFileSync(
      join(dir, 'rounds.json'),
      JSON.stringify({ a: '2', b: -1, c: 1.5, d: 3, e: null }),
    );
    expect(
      ['a', 'b', 'c', 'd', 'e'].map((check) => getRounds(project, 'session-1', check)),
    ).toEqual([0, 0, 0, 3, 0]);
  });

  it.each(['', '../escape', 'a/b', 'a\\b', 'C:x', '.', 'x'.repeat(129)])(
    'refuse the session id %j',
    (sessionId) => {
      expect(() => getRounds(project, sessionId, 'comments')).toThrow('invalid session id');
      expect(() => addRound(project, sessionId, 'comments')).toThrow('invalid session id');
      expect(filesUnder(project)).toEqual([]);
    },
  );
});

describe('state location', () => {
  it('writes files only under .theoldman/state', () => {
    setPaused(project, true);
    addRound(project, 'session-1', 'comments');
    addRound(project, 'session-2', 'docs');
    const files = filesUnder(project);
    expect(files).toHaveLength(3);
    for (const file of files) expect(file.startsWith('.theoldman/state/')).toBe(true);
  });

  it.each([['.theoldman'], ['.theoldman/state'], ['.theoldman/state/session-1']])(
    'refuses to write through a symbolic link at %s',
    (linkPath) => {
      const parts = linkPath.split('/');
      mkdirSync(join(project, ...parts.slice(0, -1)), { recursive: true });
      // 'junction' lets the test create a directory link on Windows without admin rights.
      symlinkSync(outside, join(project, ...parts), 'junction');
      expect(() => addRound(project, 'session-1', 'comments')).toThrow('is a symbolic link');
      expect(filesUnder(outside)).toEqual([]);
    },
  );

  it('stores rounds as JSON in the session directory', () => {
    addRound(project, 'abc-123', 'comments');
    const file = join(stateDir(project), 'abc-123', 'rounds.json');
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ comments: 1 });
  });
});
