// OLDMAN-G08: pausing and resuming theoldman is the user's decision. /theoldman:off and
// /theoldman:on run oldman-pause.mjs as a pre-executed command, which hooks never see. This rule
// blocks the model from running that script itself, and from creating or removing the paused
// flag file another way (touch, New-Item, a redirect, rm). Text that only mentions them, such as
// `echo "run oldman-pause.mjs"`, is allowed: only whole words and redirect targets count.

import { normalizePath } from '../lib/paths.js';
import { programName } from '../lib/shell.js';
import type { Violation } from './guard-context.js';

export const PAUSE_SCRIPT = 'oldman-pause.mjs';
const FLAG_FILE = /(?:^|\/)\.theoldman\/state\/paused$/i;
const RUNTIMES: ReadonlySet<string> = new Set(['node', 'bun', 'deno']);

export const pauseViolation: Violation = {
  id: 'OLDMAN-G08',
  message:
    "pausing or resuming theoldman is the user's decision. Ask the user to run /theoldman:off or /theoldman:on themselves.",
};

/** True for a path to the paused flag file, in any of the forms lib/paths.ts normalizes. */
export function isPauseFlag(path: string): boolean {
  return FLAG_FILE.test(normalizePath(path));
}

/** The G08 violation if this command runs the pause script or touches the paused flag. */
export function pauseCommandViolation(
  words: readonly string[],
  redirects: readonly string[],
): Violation | undefined {
  // PowerShell's call operator: `& node "...\oldman-pause.mjs" off`.
  const command = words[0] === '&' ? words.slice(1) : words;
  const runtime = command.findIndex((word) => RUNTIMES.has(programName(word)));
  const script = command.findIndex((word) => programName(word) === PAUSE_SCRIPT);
  const runsScript = script === 0 || (runtime !== -1 && script > runtime);
  const touchesFlag = [...command, ...redirects].some(isPauseFlag);
  return runsScript || touchesFlag ? pauseViolation : undefined;
}
