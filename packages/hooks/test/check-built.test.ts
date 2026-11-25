import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { diffDirs } from '../../../scripts/check-built.mjs';

let fresh: string;
let committed: string;
beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), 'theoldman-check-built-'));
  fresh = join(root, 'fresh');
  committed = join(root, 'committed');
  mkdirSync(fresh);
  mkdirSync(committed);
});
afterEach(() => {
  rmSync(join(fresh, '..'), { recursive: true, force: true });
});

describe('diffDirs', () => {
  it('finds no difference between identical builds', () => {
    writeFileSync(join(fresh, 'a.mjs'), 'line 1\nline 2\n');
    writeFileSync(join(committed, 'a.mjs'), 'line 1\nline 2\n');
    expect(diffDirs(fresh, committed)).toEqual([]);
  });

  it('treats a CRLF checkout as up to date', () => {
    writeFileSync(join(fresh, 'a.mjs'), 'line 1\nline 2\n');
    writeFileSync(join(committed, 'a.mjs'), 'line 1\r\nline 2\r\n');
    expect(diffDirs(fresh, committed)).toEqual([]);
  });

  it('reports missing, extra and changed bundles', () => {
    writeFileSync(join(fresh, 'new.mjs'), 'x\n');
    writeFileSync(join(fresh, 'same.mjs'), 'x\n');
    writeFileSync(join(fresh, 'edited.mjs'), 'new\n');
    writeFileSync(join(committed, 'same.mjs'), 'x\n');
    writeFileSync(join(committed, 'edited.mjs'), 'old\n');
    writeFileSync(join(committed, 'removed.mjs'), 'x\n');
    expect(diffDirs(fresh, committed)).toEqual([
      'missing: new.mjs',
      'extra: removed.mjs',
      'changed: edited.mjs',
    ]);
  });

  it('treats a missing directory as empty', () => {
    expect(diffDirs(join(fresh, 'none'), join(committed, 'none'))).toEqual([]);
    writeFileSync(join(fresh, 'a.mjs'), 'x\n');
    expect(diffDirs(fresh, join(committed, 'none'))).toEqual(['missing: a.mjs']);
  });
});
