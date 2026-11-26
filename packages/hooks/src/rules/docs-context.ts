// Gathers what the docs rules (rules/docs.ts) need from the project: the changed files and their
// added lines, the variables listed in .env.example files, and the dependencies and scripts
// each changed package.json gained or changed against HEAD. Reads files and runs git through
// lib/git.ts; the rules themselves only look at the result.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type DiffFile, parseDiff } from '../lib/diff.js';
import { dotenvNames } from '../lib/dotenv.js';
import { readHeadVersion, runGit } from '../lib/git.js';
import { isRecord, parseJson } from '../lib/input.js';

export interface Located {
  readonly file: string;
  readonly line: number;
}

export interface NewDependency extends Located {
  readonly name: string;
}

export interface DocsContext {
  readonly files: readonly DiffFile[];
  /** Names listed in any `.env.example` in the project, commented-out ones included. */
  readonly exampleVars: ReadonlySet<string>;
  readonly newDependencies: readonly NewDependency[];
  /** package.json files whose `scripts` changed. */
  readonly scriptChanges: readonly Located[];
  /** Claude's final message, where it may give the reason for a new dependency. */
  readonly summary: string;
}

const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
];

function readText(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    // Missing or unreadable: the caller treats it as having no content.
    return undefined;
  }
}

function manifest(text: string | undefined): Record<string, unknown> | undefined {
  const value = text === undefined ? undefined : parseJson(text);
  return isRecord(value) ? value : undefined;
}

function dependencyNames(pkg: Record<string, unknown>): Set<string> {
  return new Set(
    DEPENDENCY_FIELDS.flatMap((field) => {
      const dependencies = pkg[field];
      return isRecord(dependencies) ? Object.keys(dependencies) : [];
    }),
  );
}

/** The first added line that matches, else the first added line, else line 1. */
function lineOf(file: DiffFile, matches: (text: string) => boolean): number {
  return (file.addedLines.find(({ text }) => matches(text)) ?? file.addedLines[0])?.line ?? 1;
}

function packageChanges(projectDir: string, file: DiffFile) {
  const now = manifest(readText(join(projectDir, file.path)));
  if (now === undefined) return { dependencies: [], scripts: [] };
  const before =
    (file.status === 'added'
      ? undefined
      : manifest(readHeadVersion(join(projectDir, file.path)))) ?? {};
  const old = dependencyNames(before);
  const dependencies = [...dependencyNames(now)]
    .filter((name) => !old.has(name))
    .map((name) => ({
      file: file.path,
      line: lineOf(file, (text) => text.includes(`"${name}"`)),
      name,
    }));
  const scriptsChanged = JSON.stringify(now.scripts ?? {}) !== JSON.stringify(before.scripts ?? {});
  const scripts = scriptsChanged ? [{ file: file.path, line: lineOf(file, () => true) }] : [];
  return { dependencies, scripts };
}

function exampleVars(projectDir: string): Set<string> {
  let listed: string;
  try {
    listed = runGit(projectDir, [
      'ls-files',
      '--cached',
      '--others',
      '--exclude-standard',
      '-z',
      '--',
      ':(glob)**/.env.example',
    ]);
  } catch {
    // Not a git repository: there are no example files to read.
    return new Set();
  }
  const names = new Set<string>();
  for (const path of listed.split('\0').filter((entry) => entry !== '')) {
    for (const name of dotenvNames(readText(join(projectDir, path)) ?? '')) names.add(name);
  }
  return names;
}

/** The docs rules' view of `diff`, taken in `projectDir` (see lib/diff.ts `workingTreeDiff`). */
export function buildDocsContext(projectDir: string, diff: string, summary = ''): DocsContext {
  const files = parseDiff(diff);
  const packages = files
    .filter((file) => file.status !== 'deleted' && /(^|\/)package\.json$/.test(file.path))
    .map((file) => packageChanges(projectDir, file));
  return {
    files,
    exampleVars: exampleVars(projectDir),
    newDependencies: packages.flatMap((changes) => changes.dependencies),
    scriptChanges: packages.flatMap((changes) => changes.scripts),
    summary,
  };
}
