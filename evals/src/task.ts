// Loads and validates a task folder: evals/tasks/<id>/ with task.json, prompt.md, a starter
// project and hidden tests. The starter is a shared base app from evals/starters/<base>/, a
// folder in the task, or the base with the task's folder copied over it. The hidden tests must
// stay outside the starter, or Claude would see them during the run.

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, normalize, relative, sep } from 'node:path';
import { ConfigError } from './errors.ts';
import { SERVICES, type Service } from './images.ts';

export interface Task {
  readonly id: string;
  readonly dir: string;
  readonly title: string;
  readonly prompt: string;
  /** Folders copied in this order to make the starter: the base, then the task's own. */
  readonly starterDirs: readonly string[];
  /** The task's own hidden tests. */
  readonly hiddenTestsDir: string;
  /**
   * Folders copied over the project, in this order, before the tests run: the base's shared hidden
   * helpers (evals/hidden-support/<base>/), when there are any, then the task's hidden tests.
   */
  readonly hiddenDirs: readonly string[];
  readonly timeoutMinutes: number;
  readonly services: readonly Service[];
}

export const MAX_TIMEOUT_MINUTES = 60;
const KEYS = new Set(['title', 'base', 'starter', 'hiddenTests', 'timeoutMinutes', 'services']);
const BASE_NAME = /^[a-z0-9][a-z0-9-]*$/;

/** Loads evals/tasks/<id>; a `base` names a folder in `startersDir` (evals/starters/). */
export function loadTask(
  tasksDir: string,
  id: string,
  startersDir = join(tasksDir, '..', 'starters'),
): Task {
  const dir = join(tasksDir, id);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new ConfigError(`Task "${id}" not found: there is no folder ${dir}.`);
  }
  const where = (file: string): string => `${id}/${file}`;
  const json = readJson(join(dir, 'task.json'), where('task.json'));

  const unknown = Object.keys(json).filter((key) => !KEYS.has(key));
  if (unknown.length > 0) {
    throw new ConfigError(`${where('task.json')}: unknown field ${unknown.join(', ')}.`);
  }
  const invalid = (message: string): ConfigError =>
    new ConfigError(`${where('task.json')}: ${message}`);

  const { title, base, starter, hiddenTests, timeoutMinutes, services = [] } = json;
  if (typeof title !== 'string' || title.trim() === '') {
    throw invalid('"title" must be a non-empty string.');
  }
  if (
    typeof timeoutMinutes !== 'number' ||
    !Number.isInteger(timeoutMinutes) ||
    timeoutMinutes < 1 ||
    timeoutMinutes > MAX_TIMEOUT_MINUTES
  ) {
    throw invalid(
      `"timeoutMinutes" must be a whole number from 1 to ${String(MAX_TIMEOUT_MINUTES)}.`,
    );
  }
  if (!Array.isArray(services) || !services.every(isService)) {
    throw invalid(`"services" must be a list of: ${SERVICES.join(', ')}.`);
  }
  const starterDirs: string[] = [];
  const hiddenDirs: string[] = [];
  if (base !== undefined) {
    if (typeof base !== 'string' || !BASE_NAME.test(base)) {
      throw invalid('"base" must name a folder in evals/starters/, such as "next-prisma".');
    }
    const baseDir = join(startersDir, base);
    if (!existsSync(baseDir) || !statSync(baseDir).isDirectory()) {
      throw invalid(`"base" starter "${base}" does not exist in evals/starters/.`);
    }
    starterDirs.push(baseDir);
    const support = join(startersDir, '..', 'hidden-support', base);
    if (existsSync(support) && statSync(support).isDirectory()) hiddenDirs.push(support);
  }
  if (starter !== undefined || base === undefined) {
    starterDirs.push(taskFolder(dir, starter, 'starter', invalid));
  }
  const hiddenTestsDir = taskFolder(dir, hiddenTests, 'hiddenTests', invalid);
  if (starterDirs.some((s) => isInside(s, hiddenTestsDir) || isInside(hiddenTestsDir, s))) {
    throw invalid(
      '"starter" and "hiddenTests" must be separate folders, so the hidden tests stay hidden.',
    );
  }
  if (readdirSync(hiddenTestsDir).length === 0) {
    throw invalid('the "hiddenTests" folder is empty.');
  }
  hiddenDirs.push(hiddenTestsDir);

  const promptFile = join(dir, 'prompt.md');
  if (!existsSync(promptFile)) throw new ConfigError(`${where('prompt.md')} is missing.`);
  const prompt = readFileSync(promptFile, 'utf8').trim();
  if (prompt === '') throw new ConfigError(`${where('prompt.md')} is empty.`);

  return {
    id,
    dir,
    title: title.trim(),
    prompt,
    starterDirs,
    hiddenTestsDir,
    hiddenDirs,
    timeoutMinutes,
    services,
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
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ConfigError(`${label} must hold a JSON object.`);
  }
  return value as Record<string, unknown>;
}

const isService = (value: unknown): value is Service =>
  typeof value === 'string' && (SERVICES as readonly string[]).includes(value);

/** Resolves a folder named in task.json, which must stay inside the task folder. */
function taskFolder(
  taskDir: string,
  value: unknown,
  field: string,
  invalid: (message: string) => ConfigError,
): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw invalid(`"${field}" must name a folder in the task.`);
  }
  const path = normalize(value);
  if (isAbsolute(path) || path === '.' || path.split(sep).includes('..')) {
    throw invalid(`"${field}" must be a folder inside the task, not "${value}".`);
  }
  const full = join(taskDir, path);
  if (!existsSync(full) || !statSync(full).isDirectory()) {
    throw invalid(`"${field}" folder "${value}" does not exist.`);
  }
  return full;
}

function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * SHA-256 of the starter Claude gets: the files of `dirs` copied over each other in order, by
 * path (with `/`) and content. Scoring rebuilds a run's project from the starter and the run's
 * diff, so the plan records which starter the run used. For one folder it is that folder's hash.
 */
export function starterHash(dirs: readonly string[]): string {
  const files = new Map<string, string>();
  for (const dir of dirs) {
    for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const file = join(entry.parentPath, entry.name);
      files.set(relative(dir, file).split(sep).join('/'), file);
    }
  }
  const hash = createHash('sha256');
  for (const path of [...files.keys()].sort()) {
    hash.update(path).update('\0');
    hash.update(readFileSync(files.get(path) ?? '')).update('\0');
  }
  return `sha256:${hash.digest('hex')}`;
}

/** SHA-256 of one folder's files: their paths (with `/`) and contents. */
export function folderHash(dir: string): string {
  return starterHash([dir]);
}
