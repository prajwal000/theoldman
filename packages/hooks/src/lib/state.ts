import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isRecord, parseJson } from './input.js';

const PAUSED_FILE = 'paused';
const ROUNDS_FILE = 'rounds.json';
// Session IDs become directory names, so anything that could form a path (`..`, `/`, `\`, `:`) is refused.
const SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/;

export function stateDir(projectDir: string): string {
  return join(projectDir, '.theoldman', 'state');
}

function sessionSegment(sessionId: string): string {
  if (!SESSION_ID.test(sessionId)) throw new Error('invalid session id');
  return sessionId;
}

/**
 * Creates `.theoldman/state[/<session>]` and returns its path. A cloned repo could commit any
 * of these as a symbolic link to somewhere else, so writing through a link is refused.
 */
function ensureStateDir(projectDir: string, ...segments: string[]): string {
  let dir = projectDir;
  for (const segment of ['.theoldman', 'state', ...segments]) {
    dir = join(dir, segment);
    if (!existsSync(dir)) mkdirSync(dir);
    if (lstatSync(dir).isSymbolicLink()) {
      throw new Error(`${segment} is a symbolic link; refusing to write state through it`);
    }
  }
  return dir;
}

export function isPaused(projectDir: string): boolean {
  return existsSync(join(stateDir(projectDir), PAUSED_FILE));
}

export function setPaused(projectDir: string, paused: boolean): void {
  const file = join(ensureStateDir(projectDir), PAUSED_FILE);
  if (paused) {
    writeFileSync(file, '');
  } else {
    rmSync(file, { force: true });
  }
}

function readRounds(file: string): Map<string, number> {
  const rounds = new Map<string, number>();
  const value = existsSync(file) ? parseJson(readFileSync(file, 'utf8')) : undefined;
  // A corrupt file resets the counts rather than failing: at worst Claude gets a few more rounds.
  if (!isRecord(value)) return rounds;
  for (const [check, count] of Object.entries(value)) {
    if (typeof count === 'number' && Number.isInteger(count) && count >= 0) {
      rounds.set(check, count);
    }
  }
  return rounds;
}

/** Number of Fix rounds already sent for this check type in this session. */
export function getRounds(projectDir: string, sessionId: string, check: string): number {
  const file = join(stateDir(projectDir), sessionSegment(sessionId), ROUNDS_FILE);
  return readRounds(file).get(check) ?? 0;
}

/** Records one more Fix round for this check type and returns the new count. */
export function addRound(projectDir: string, sessionId: string, check: string): number {
  const file = join(ensureStateDir(projectDir, sessionSegment(sessionId)), ROUNDS_FILE);
  const rounds = readRounds(file);
  const next = (rounds.get(check) ?? 0) + 1;
  rounds.set(check, next);
  writeFileSync(file, JSON.stringify(Object.fromEntries(rounds)));
  return next;
}
