import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectStack } from '../../src/lib/stack.js';

let project: string;
beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'theoldman-stack-'));
});
afterEach(() => {
  rmSync(project, { recursive: true, force: true });
});

const writePackage = (value: unknown): void => {
  writeFileSync(join(project, 'package.json'), JSON.stringify(value));
};

describe('detectStack', () => {
  it('reads every dependency field and returns the stack in a fixed order', () => {
    writePackage({
      dependencies: { express: '^5', '@prisma/client': '^6', react: '^19', next: '^15' },
      devDependencies: { typescript: '^5', vitest: '^3' },
      peerDependencies: { jest: '*' },
    });
    expect(detectStack(project)).toEqual([
      'typescript',
      'nextjs',
      'react',
      'prisma',
      'express',
      'vitest',
      'jest',
    ]);
  });

  it('counts the prisma CLI and optional dependencies, and ignores other packages', () => {
    writePackage({ optionalDependencies: { prisma: '^6' }, dependencies: { lodash: '^4' } });
    expect(detectStack(project)).toEqual(['prisma']);
  });

  it('matches package names exactly, not by prefix or in scripts', () => {
    writePackage({
      dependencies: { 'react-dom': '^19', 'next-auth': '^5' },
      scripts: { test: 'jest' },
    });
    expect(detectStack(project)).toEqual([]);
  });

  it.each([
    ['there is no package.json', undefined],
    ['package.json is not valid JSON', '{'],
    ['package.json is not an object', '["react"]'],
    ['a dependency field is not an object', '{"dependencies": ["react"]}'],
  ])('returns nothing when %s', (_name, text) => {
    if (text !== undefined) writeFileSync(join(project, 'package.json'), text);
    expect(detectStack(project)).toEqual([]);
  });

  it('returns nothing when package.json is a folder', () => {
    mkdirSync(join(project, 'package.json'));
    expect(detectStack(project)).toEqual([]);
  });
});
