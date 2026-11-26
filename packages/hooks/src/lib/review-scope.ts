// How much review a change gets, and with which rules. Docs-only and tests-only changes get none,
// small code changes a light self-review, larger ones the reviewer and verifier subagents, who get
// only the topic skills that fit the changed files and the session's prompts. Fewer subagents and
// smaller prompts are most of what the review costs.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DiffFile } from './diff.js';
import { type Category, classify } from './router.js';
import { readSessionJson, writeSessionFile, writeSessionJson } from './state.js';

export type ReviewKind = 'none' | 'light' | 'full';

const DOC_FILE = /\.(?:md|mdx|markdown|txt|rst|adoc)$|(?:^|\/)(?:license|changelog)[^/]*$/i;
const TEST_FILE = /(?:^|\/)(?:__tests__|tests?)\/|\.(?:test|spec)\.[cm]?[jt]sx?$/i;
// A test change that skips tests could be weakening them, which the rules forbid.
const SKIPS_TESTS = /\.(?:skip|only|todo)\s*\(|\b(?:xit|xdescribe|xtest)\s*\(/;
const CATEGORIES_FILE = 'categories.json';
const CATEGORY_NAMES: readonly string[] = [
  'auth',
  'db',
  'api',
  'infra',
  'tests',
  'git',
  'docs',
  'ui',
];
const SKILL_FOR: Readonly<Record<Category, string | undefined>> = {
  auth: 'oldman-security',
  api: 'oldman-security',
  infra: 'oldman-security',
  db: 'oldman-database',
  tests: 'oldman-testing',
  docs: 'oldman-docs',
  git: undefined,
  ui: undefined,
};

const isCategory = (value: unknown): value is Category =>
  typeof value === 'string' && CATEGORY_NAMES.includes(value);

/**
 * `none` for docs and tests only (unless a test change removes lines or skips tests), `light`
 * for at most `lightMaxLines` added and removed code lines, `full` otherwise.
 */
export function reviewKind(files: readonly DiffFile[], lightMaxLines: number): ReviewKind {
  const code = files.filter((file) => !DOC_FILE.test(file.path) && !TEST_FILE.test(file.path));
  if (code.length === 0) {
    const weakens = files.some(
      (file) =>
        TEST_FILE.test(file.path) &&
        (file.removedLines > 0 || file.addedLines.some(({ text }) => SKIPS_TESTS.test(text))),
    );
    return weakens ? 'light' : 'none';
  }
  const size = code.reduce((total, file) => total + file.addedLines.length + file.removedLines, 0);
  return size <= lightMaxLines ? 'light' : 'full';
}

/** Prompt categories the router saw in this session. */
export function sessionCategories(projectDir: string, sessionId: string): Category[] {
  const value = readSessionJson(projectDir, sessionId, CATEGORIES_FILE);
  return Array.isArray(value) ? value.filter(isCategory) : [];
}

export function recordCategories(
  projectDir: string,
  sessionId: string,
  categories: readonly Category[],
): void {
  const known = sessionCategories(projectDir, sessionId);
  const added = categories.filter((category) => !known.includes(category));
  if (added.length > 0)
    writeSessionJson(projectDir, sessionId, CATEGORIES_FILE, [...known, ...added]);
}

/** Topic skills for a review, from the changed paths and the session's prompt categories. */
export function reviewSkills(paths: readonly string[], categories: readonly Category[]): string[] {
  const fromPaths = classify(paths.join(' ').replace(/[/\\._-]+/g, ' '));
  const skills = [...fromPaths, ...categories].map((category) => SKILL_FOR[category]);
  return [...new Set(skills.filter((skill): skill is string => skill !== undefined))].sort();
}

/**
 * Writes the bodies of `skills` from the plugin's skills folder to the session's
 * review-rules.md and returns its path; undefined when there is nothing to write.
 */
export function writeReviewRules(
  pluginRoot: string,
  projectDir: string,
  sessionId: string,
  skills: readonly string[],
): string | undefined {
  const bodies = skills.flatMap((skill) => {
    try {
      const text = readFileSync(join(pluginRoot, 'skills', skill, 'SKILL.md'), 'utf8');
      return [text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim()];
    } catch {
      // A missing skill file leaves that topic out; the core rules still apply.
      return [];
    }
  });
  if (bodies.length === 0) return undefined;
  return writeSessionFile(
    projectDir,
    sessionId,
    'review-rules.md',
    `${bodies.join('\n\n---\n\n')}\n`,
  );
}
