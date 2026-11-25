import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { findPackageScripts } from '../../src/lib/package-scripts.js';

describe('findPackageScripts', () => {
  const root = mkdtempSync(join(tmpdir(), 'theoldman-scripts-'));
  const app = join(root, 'app');
  const deep = join(app, 'src', 'deep');
  mkdirSync(deep, { recursive: true });
  writeFileSync(
    join(app, 'package.json'),
    JSON.stringify({ scripts: { build: 'tsc', odd: 42, 'db:reset': 'prisma migrate reset' } }),
  );
  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('finds the nearest package.json above the start directory and keeps string scripts', () => {
    const found = findPackageScripts(deep);
    expect(found?.dir).toBe(resolve(app));
    expect([...(found?.scripts ?? [])]).toEqual([
      ['build', 'tsc'],
      ['db:reset', 'prisma migrate reset'],
    ]);
  });

  it('gives no scripts for a package.json without scripts, unreadable JSON, or a directory', () => {
    for (const [name, content] of [
      ['plain', '{"name":"x"}'],
      ['broken', '{ not json'],
      ['array', '{"scripts":["x"]}'],
    ] as const) {
      const dir = join(root, name);
      mkdirSync(dir);
      writeFileSync(join(dir, 'package.json'), content);
      expect(findPackageScripts(dir)?.scripts.size).toBe(0);
    }
    const odd = join(root, 'odd');
    mkdirSync(join(odd, 'package.json'), { recursive: true });
    expect(findPackageScripts(odd)?.scripts.size).toBe(0);
  });

  it('returns undefined when no package.json exists up to the filesystem root', () => {
    expect(findPackageScripts(resolve('/theoldman-no-such-dir/a/b'))).toBeUndefined();
  });
});
