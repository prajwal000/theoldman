// OLDMAN-G09: theoldman's settings and Claude Code's settings are the user's to change, so the
// model cannot weaken theoldman by editing them instead of pausing it. Covered: .theoldman.json,
// anything under .theoldman/ (only hooks and scripts write there; the paused flag is G08),
// .claude/settings.json, .claude/settings.local.json, managed-settings.json, and the installed
// plugins under .claude/plugins/. /theoldman:init still writes .theoldman.json: its script runs
// as a pre-executed command, which hooks never see.
//
// In commands only writes count: redirect targets, and the file arguments of programs that
// write, move or delete. Reading (`cat .theoldman.json`) and `git add` stay allowed. A program
// that writes on its own, such as `node -e` or a script file, is not seen.

import { normalizePath } from '../lib/paths.js';
import { programName } from '../lib/shell.js';
import type { Violation } from './guard-context.js';
import { isPauseFlag } from './guard-pause.js';

const PROTECTED = [
  /(?:^|\/)\.theoldman\.json$/i,
  /(?:^|\/)\.theoldman(?:\/|$)/i,
  /(?:^|\/)\.claude\/settings(?:\.local)?\.json$/i,
  /(?:^|\/)managed-settings\.json$/i,
  /(?:^|\/)\.claude\/plugins(?:\/|$)/i,
];
// Programs whose file arguments are written, moved or deleted (bash and PowerShell names).
const WRITERS: ReadonlySet<string> = new Set([
  'rm',
  'rmdir',
  'unlink',
  'mv',
  'touch',
  'truncate',
  'tee',
  'ln',
  'chmod',
  'chown',
  'mkdir',
  'remove-item',
  'ri',
  'del',
  'erase',
  'rd',
  'move-item',
  'mi',
  'move',
  'rename-item',
  'rni',
  'ren',
  'new-item',
  'ni',
  'set-content',
  'sc',
  'add-content',
  'ac',
  'out-file',
  'clear-content',
  'clc',
]);
// Copies write only their last argument; the sources are just read.
const COPIERS: ReadonlySet<string> = new Set(['cp', 'install', 'copy-item', 'cpi', 'copy']);
const GIT_WRITERS: ReadonlySet<string> = new Set(['rm', 'mv', 'restore', 'checkout']);

export const configViolation: Violation = {
  id: 'OLDMAN-G09',
  message:
    "theoldman's settings and Claude Code's settings are the user's to change. Tell the user what to change and why, and let them edit the file or run /theoldman:init.",
};

/** True for theoldman's or Claude Code's settings files, in any path form; not the paused flag. */
export function isProtectedConfig(path: string): boolean {
  const normalized = normalizePath(path);
  return !isPauseFlag(normalized) && PROTECTED.some((pattern) => pattern.test(normalized));
}

function writtenFiles(words: readonly string[]): readonly string[] {
  const [first = '', ...rest] = words;
  const program = programName(first);
  if (WRITERS.has(program)) return rest;
  if (COPIERS.has(program)) return rest.slice(-1);
  if (program === 'sed' || program === 'perl')
    return rest.some((w) => /^-\w*i/.test(w)) ? rest : [];
  if (program === 'git' && GIT_WRITERS.has(rest[0] ?? '')) return rest.slice(1);
  return [];
}

/** The G09 violation if this command writes, moves or deletes a protected settings file. */
export function configCommandViolation(
  words: readonly string[],
  redirects: readonly string[],
): Violation | undefined {
  const command = words[0] === '&' ? words.slice(1) : words;
  const targets = [...writtenFiles(command), ...redirects];
  return targets.some(isProtectedConfig) ? configViolation : undefined;
}
