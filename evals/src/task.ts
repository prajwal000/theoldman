// Loads and validates a task folder: evals/tasks/<id>/ with task.json, prompt.md, a starter
// project and hidden tests. The hidden tests must stay outside the starter, or Claude would see
// them during the run.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, normalize, relative, sep } from 'node:path';
import { ConfigError } from './errors.ts';
import { SERVICES, type Service } from './images.ts';

export interface Task {
  readonly id: string;
  readonly dir: string;
  readonly title: string;
  readonly prompt: string;
  readonly starterDir: string;
  readonly hiddenTestsDir: string;
  readonly timeoutMinutes: number;
  readonly services: readonly Service[];
}

export const MAX_TIMEOUT_MINUTES = 60;
const KEYS = new Set(['title', 'starter', 'hiddenTests', 'timeoutMinutes', 'services']);

export function loadTask(tasksDir: string, id: string): Task {
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

  const { title, starter, hiddenTests, timeoutMinutes, services = [] } = json;
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
  const starterDir = taskFolder(dir, starter, 'starter', invalid);
  const hiddenTestsDir = taskFolder(dir, hiddenTests, 'hiddenTests', invalid);
  if (isInside(starterDir, hiddenTestsDir) || isInside(hiddenTestsDir, starterDir)) {
    throw invalid(
      '"starter" and "hiddenTests" must be separate folders, so the hidden tests stay hidden.',
    );
  }
  if (readdirSync(hiddenTestsDir).length === 0) {
    throw invalid('the "hiddenTests" folder is empty.');
  }

  const promptFile = join(dir, 'prompt.md');
  if (!existsSync(promptFile)) throw new ConfigError(`${where('prompt.md')} is missing.`);
  const prompt = readFileSync(promptFile, 'utf8').trim();
  if (prompt === '') throw new ConfigError(`${where('prompt.md')} is empty.`);

  return {
    id,
    dir,
    title: title.trim(),
    prompt,
    starterDir,
    hiddenTestsDir,
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
