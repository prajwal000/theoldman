// Which files this session changed. Write and Edit are recorded as they happen (touched files,
// lib/state.ts). Changes made another way, such as a Bash command or a formatter, are found by
// comparing the files that differ from git with a baseline taken at session start, so the
// user's own uncommitted work from before the session is not counted.

import { statSync } from 'node:fs';
import { join } from 'node:path';
import { runGit } from './git.js';
import { isRecord } from './input.js';
import { readSessionJson, touchedFiles, writeSessionJson } from './state.js';

const BASELINE_FILE = 'baseline.json';
// Above this many changed files, fingerprinting costs more than it is worth; touched files
// alone are used.
const MAX_DIRTY_FILES = 5000;

function fingerprint(file: string): string {
  try {
    const stats = statSync(file);
    return `${String(stats.size)}:${String(stats.mtimeMs)}`;
  } catch {
    // Deleted since git listed it: that is a fingerprint of its own.
    return 'missing';
  }
}

/**
 * Files in `projectDir` that differ from git (modified, deleted or untracked and not ignored),
 * each with a size and modification-time fingerprint. Undefined outside a repo or when there
 * are more than `limit`.
 */
export function dirtyFiles(
  projectDir: string,
  limit = MAX_DIRTY_FILES,
): Record<string, string> | undefined {
  let listed: string;
  try {
    listed = runGit(projectDir, [
      'ls-files',
      '--modified',
      '--deleted',
      '--others',
      '--exclude-standard',
      '-z',
    ]);
  } catch {
    // Not a git repository: there is nothing to compare against.
    return undefined;
  }
  const paths = [...new Set(listed.split('\0').filter((path) => path !== ''))];
  if (paths.length > limit) return undefined;
  return Object.fromEntries(paths.map((path) => [path, fingerprint(join(projectDir, path))]));
}

/** Takes the session's baseline once; later calls (resume, /clear, compaction) keep the first. */
export function recordBaseline(projectDir: string, sessionId: string): void {
  if (readSessionJson(projectDir, sessionId, BASELINE_FILE) !== undefined) return;
  writeSessionJson(projectDir, sessionId, BASELINE_FILE, dirtyFiles(projectDir) ?? null);
}

const insideProject = (path: string): boolean => !/^(?:[a-z]:|\/|\.\.(?:\/|$))/i.test(path);

/**
 * Project-relative files this session changed: those Write and Edit touched inside the project,
 * plus files whose fingerprint differs from the baseline. Without a baseline (the plugin was
 * enabled mid-session, or the project is not a git repo), touched files only.
 */
export function sessionChanges(projectDir: string, sessionId: string): string[] {
  const touched = touchedFiles(projectDir, sessionId).filter(insideProject);
  const baseline = readSessionJson(projectDir, sessionId, BASELINE_FILE);
  const now = isRecord(baseline) ? dirtyFiles(projectDir) : undefined;
  const changed = isRecord(baseline)
    ? Object.entries(now ?? {})
        .filter(([path, print]) => baseline[path] !== print)
        .map(([path]) => path)
    : [];
  return [...new Set([...touched, ...changed])];
}
