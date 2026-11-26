import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DiffFile } from '../../src/lib/diff.js';
import {
  recordCategories,
  reviewKind,
  reviewSkills,
  sessionCategories,
  writeReviewRules,
} from '../../src/lib/review-scope.js';
import { stateDir } from '../../src/lib/state.js';

const pluginRoot = fileURLToPath(new URL('../../../../plugin/', import.meta.url));

let project: string;
beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'theoldman-scope-'));
});
afterEach(() => {
  rmSync(project, { recursive: true, force: true });
});

function file(path: string, added: string[], removedLines = 0): DiffFile {
  return {
    path,
    status: 'modified',
    addedLines: added.map((text, i) => ({ line: i + 1, text })),
    removedLines,
  };
}

const lines = (n: number): string[] =>
  Array.from({ length: n }, (_, i) => `const v${String(i)} = ${String(i)};`);

describe('reviewKind', () => {
  it('skips docs-only and tests-only changes', () => {
    expect(reviewKind([file('README.md', ['x']), file('docs/a.md', ['y'])], 40)).toBe('none');
    expect(reviewKind([file('src/a.test.ts', lines(50)), file('test/b.ts', ['z'])], 40)).toBe(
      'none',
    );
    expect(reviewKind([file('src/__tests__/c.tsx', ['w']), file('LICENSE', ['v'])], 40)).toBe(
      'none',
    );
  });

  it('looks at a tests-only change that removes lines or skips tests', () => {
    expect(reviewKind([file('src/a.test.ts', ['x'], 1)], 40)).toBe('light');
    for (const text of ['it.skip("a", () => {});', 'describe.only("b", () => {', 'xit("c", f)']) {
      expect(reviewKind([file('src/a.spec.ts', [text])], 40), text).toBe('light');
    }
  });

  it('counts added and removed code lines, not docs or tests, against the threshold', () => {
    const code = file('src/a.ts', lines(30), 10);
    expect(
      reviewKind([code, file('src/a.test.ts', lines(80)), file('README.md', lines(20))], 40),
    ).toBe('light');
    expect(reviewKind([file('src/a.ts', lines(30), 11)], 40)).toBe('full');
    expect(reviewKind([file('src/a.ts', ['x'])], 0)).toBe('full');
  });
});

describe('reviewSkills', () => {
  it('picks topic skills from the changed paths and the prompt categories', () => {
    expect(reviewSkills(['prisma/schema.prisma', 'src/lib/money.test.ts'], [])).toEqual([
      'oldman-database',
      'oldman-testing',
    ]);
    expect(reviewSkills(['src/app/api/orders/[id]/route.ts'], ['docs'])).toEqual([
      'oldman-docs',
      'oldman-security',
    ]);
    expect(reviewSkills(['src/components/Button.tsx'], ['ui', 'git'])).toEqual([]);
  });
});

describe('session categories', () => {
  it('records each category once and reads back only known ones', () => {
    expect(sessionCategories(project, 's1')).toEqual([]);
    recordCategories(project, 's1', ['api', 'db']);
    recordCategories(project, 's1', ['db', 'tests']);
    recordCategories(project, 's1', []);
    expect(sessionCategories(project, 's1')).toEqual(['api', 'db', 'tests']);
    writeFileSync(join(stateDir(project), 's1', 'categories.json'), '["api", "bogus", 3]');
    expect(sessionCategories(project, 's1')).toEqual(['api']);
    writeFileSync(join(stateDir(project), 's1', 'categories.json'), '{"api": true}');
    expect(sessionCategories(project, 's1')).toEqual([]);
  });
});

describe('writeReviewRules', () => {
  it('writes the skill bodies without frontmatter, skipping missing skills', () => {
    const path = writeReviewRules(pluginRoot, project, 's1', ['oldman-testing', 'oldman-nope']);
    expect(path).toBe(join(stateDir(project), 's1', 'review-rules.md'));
    const text = readFileSync(path ?? '', 'utf8');
    expect(text.startsWith('# Testing\n')).toBe(true);
    expect(text).not.toContain('user-invocable');
  });

  it('writes nothing for no skills, or only missing ones', () => {
    expect(writeReviewRules(pluginRoot, project, 's1', [])).toBeUndefined();
    const empty = join(project, 'plugin');
    mkdirSync(join(empty, 'skills'), { recursive: true });
    expect(writeReviewRules(empty, project, 's1', ['oldman-testing'])).toBeUndefined();
  });
});
