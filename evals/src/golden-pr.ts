// Loads and validates a golden PR: evals/golden-prs/<id>/ with pr.json and pr.patch. The patch
// applies to a shared starter (evals/starters/<base>/) and becomes one commit on its own branch.
// The golden comments are the known problems a review should find; they stay on the host and
// never reach the container Claude reviews in.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigError } from './errors.ts';
import { starterHash } from './task.ts';

export interface GoldenComment {
  readonly id: string;
  /** Path in the project, with `/`. */
  readonly file: string;
  /** Line in the file after the change. */
  readonly line: number;
  readonly issue: string;
}

export interface InjectionRule {
  /** Tool names whose calls are checked, such as Bash and PowerShell. */
  readonly tools: readonly string[];
  /** Matched against each string value of a tool call's input. */
  readonly pattern: string;
}

export interface Injection {
  readonly instruction: string;
  /** The instruction counts as followed if any tool call matches one of these. */
  readonly followedIf: readonly InjectionRule[];
}

export interface GoldenPr {
  readonly id: string;
  readonly dir: string;
  readonly title: string;
  readonly description: string;
  readonly branch: string;
  readonly starterDirs: readonly string[];
  readonly patch: string;
  /** True for a PR with nothing to report: any finding on it is a false positive. */
  readonly clean: boolean;
  readonly comments: readonly GoldenComment[];
  readonly injection: Injection | null;
}

/** The same prompt for every PR and both conditions, from evals/golden-prs/prompt.md. */
export const PROMPT_FILE = 'prompt.md';
const KEYS = new Set(['title', 'description', 'base', 'branch', 'clean', 'comments', 'injection']);
const ID = /^[a-z0-9][a-z0-9-]*$/;
const BRANCH = /^[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)*$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== '';

export function loadReviewPrompt(prsDir: string): string {
  const file = join(prsDir, PROMPT_FILE);
  const prompt = existsSync(file) ? readFileSync(file, 'utf8').trim() : '';
  if (prompt === '') throw new ConfigError(`golden-prs/${PROMPT_FILE} is missing or empty.`);
  return prompt;
}

export function loadGoldenPr(
  prsDir: string,
  id: string,
  startersDir = join(prsDir, '..', 'starters'),
): GoldenPr {
  const dir = join(prsDir, id);
  if (!ID.test(id) || !existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new ConfigError(`Golden PR "${id}" not found: there is no folder ${dir}.`);
  }
  const invalid = (message: string): ConfigError => new ConfigError(`${id}/pr.json: ${message}`);
  const json = readJson(join(dir, 'pr.json'), `${id}/pr.json`);
  const unknown = Object.keys(json).filter((key) => !KEYS.has(key));
  if (unknown.length > 0) throw invalid(`unknown field ${unknown.join(', ')}.`);

  const { title, description, base, branch, clean = false, comments, injection } = json;
  if (!isText(title)) throw invalid('"title" must be a non-empty string.');
  if (!isText(description)) throw invalid('"description" must be a non-empty string.');
  if (typeof base !== 'string' || !ID.test(base)) {
    throw invalid('"base" must name a folder in evals/starters/, such as "next-prisma".');
  }
  const baseDir = join(startersDir, base);
  if (!existsSync(baseDir) || !statSync(baseDir).isDirectory()) {
    throw invalid(`"base" starter "${base}" does not exist in evals/starters/.`);
  }
  if (typeof branch !== 'string' || !BRANCH.test(branch) || branch === 'main') {
    throw invalid('"branch" must be a branch name such as "cancel-orders", other than main.');
  }
  if (typeof clean !== 'boolean') throw invalid('"clean" must be true or false.');

  const patchFile = join(dir, 'pr.patch');
  const patch = existsSync(patchFile) ? readFileSync(patchFile, 'utf8') : '';
  if (!patch.startsWith('diff --git '))
    throw new ConfigError(`${id}/pr.patch is missing or not a git diff.`);
  const changed = changedFiles(patch);

  const golden = readComments(comments, changed, invalid);
  if (clean && golden.length > 0) throw invalid('a clean PR cannot have golden comments.');
  if (!clean && golden.length === 0) {
    throw invalid('list at least one golden comment, or mark the PR "clean": true.');
  }
  return {
    id,
    dir,
    title: title.trim(),
    description: description.trim(),
    branch,
    starterDirs: [baseDir],
    patch,
    clean,
    comments: golden,
    injection: injection === undefined ? null : readInjection(injection, invalid),
  };
}

function readJson(file: string, label: string): Record<string, unknown> {
  if (!existsSync(file)) throw new ConfigError(`${label} is missing.`);
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new ConfigError(
      `${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isRecord(value)) throw new ConfigError(`${label} must hold a JSON object.`);
  return value;
}

/** Paths the patch leaves in place, from its `+++ b/<path>` lines. */
function changedFiles(patch: string): Set<string> {
  return new Set([...patch.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((match) => match[1] ?? ''));
}

function readComments(
  value: unknown,
  changed: ReadonlySet<string>,
  invalid: (message: string) => ConfigError,
): GoldenComment[] {
  if (!Array.isArray(value)) throw invalid('"comments" must be a list.');
  const ids = new Set<string>();
  return value.map((entry: unknown, index) => {
    const where = `comments[${String(index)}]`;
    if (!isRecord(entry)) throw invalid(`${where} must be an object.`);
    const { id, file, line, issue } = entry;
    const extra = Object.keys(entry).filter(
      (key) => !['id', 'file', 'line', 'issue'].includes(key),
    );
    if (extra.length > 0) throw invalid(`${where}: unknown field ${extra.join(', ')}.`);
    if (typeof id !== 'string' || !ID.test(id)) {
      throw invalid(`${where}.id must use lowercase letters, digits and "-".`);
    }
    if (ids.has(id)) throw invalid(`${where}.id "${id}" is used twice.`);
    ids.add(id);
    if (typeof file !== 'string' || !changed.has(file)) {
      throw invalid(`${where}.file must be a file the patch changes.`);
    }
    if (typeof line !== 'number' || !Number.isInteger(line) || line < 1) {
      throw invalid(`${where}.line must be a line number.`);
    }
    if (!isText(issue)) throw invalid(`${where}.issue must be a non-empty string.`);
    return { id, file, line, issue: issue.trim() };
  });
}

function readInjection(value: unknown, invalid: (message: string) => ConfigError): Injection {
  if (!isRecord(value) || !isText(value.instruction) || !Array.isArray(value.followedIf)) {
    throw invalid('"injection" needs an "instruction" and a "followedIf" list.');
  }
  if (value.followedIf.length === 0) throw invalid('"injection.followedIf" is empty.');
  const followedIf = value.followedIf.map((rule: unknown, index) => {
    const where = `injection.followedIf[${String(index)}]`;
    if (
      !isRecord(rule) ||
      !Array.isArray(rule.tools) ||
      rule.tools.length === 0 ||
      !rule.tools.every(isText) ||
      !isText(rule.pattern)
    ) {
      throw invalid(`${where} needs "tools" (tool names) and a "pattern".`);
    }
    try {
      new RegExp(rule.pattern);
    } catch {
      throw invalid(`${where}.pattern is not a valid regular expression.`);
    }
    return { tools: rule.tools, pattern: rule.pattern };
  });
  return { instruction: value.instruction.trim(), followedIf };
}

/** The commit message the PR's branch gets: its title, then its description. */
export function commitMessage(pr: GoldenPr): string {
  return `${pr.title}\n\n${pr.description}\n`;
}

/** What a run reviewed: the starter and the patch. Scoring refuses a run if either changed. */
export function goldenPrHash(pr: GoldenPr): string {
  const hash = createHash('sha256')
    .update(starterHash(pr.starterDirs))
    .update('\0')
    .update(pr.patch)
    .update('\0')
    .update(commitMessage(pr));
  return `sha256:${hash.digest('hex')}`;
}
