// OLDMAN-G03: recursive, forced deletes (`rm -rf`, `Remove-Item -Recurse -Force` and its aliases)
// of anything not strictly inside the project root: `/`, `~`, `..`, drive roots, other absolute
// paths, and the project root itself.

import { isStrictlyInside } from '../lib/paths.js';
import { type Dialect, isAbbreviation as isParameter, programName } from '../lib/shell.js';
import { resolveTarget } from './command-expand.js';
import type { GuardContext, Violation } from './guard-context.js';

const REMOVE_ITEM = new Set(['remove-item', 'rm', 'ri', 'del', 'erase', 'rd', 'rmdir']);

/** Targets of `rm` when both recursive and forced, else none. */
function rmTargets(args: readonly string[]): string[] {
  let recursive = false;
  let force = false;
  const targets: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? '';
    if (arg === '--') {
      targets.push(...args.slice(i + 1));
      break;
    } else if (arg.startsWith('--')) {
      recursive ||= arg === '--recursive';
      force ||= arg === '--force';
    } else if (arg.startsWith('-') && arg.length > 1) {
      recursive ||= /[rR]/.test(arg);
      force ||= arg.includes('f');
    } else {
      targets.push(arg);
    }
  }
  return recursive && force ? targets : [];
}

/** Targets of `Remove-Item` with both -Recurse and -Force and no -WhatIf, else none. */
function removeItemTargets(args: readonly string[]): string[] {
  let recursive = false;
  let force = false;
  let whatIf = false;
  const targets: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? '';
    if (!arg.startsWith('-')) {
      targets.push(arg);
      continue;
    }
    const [name = '', attached] = arg.slice(1).toLowerCase().split(/:(.*)/s);
    const takesValue = ['path', 'literalpath', 'lp'].some((p) =>
      isParameter(name, p, p === 'lp' ? 2 : 1),
    );
    if (takesValue) {
      const value = attached ?? args[++i];
      if (value !== undefined) targets.push(value);
    } else if (
      ['filter', 'include', 'exclude', 'credential', 'stream'].some((p) => isParameter(name, p, 2))
    ) {
      if (attached === undefined) i++;
    }
    recursive ||= isParameter(name, 'recurse', 1);
    force ||= isParameter(name, 'force', 2);
    whatIf ||= isParameter(name, 'whatif', 1);
  }
  return recursive && force && !whatIf ? targets : [];
}

/** `cwd` is the directory the command runs in, after any `cd` earlier on the line. */
export function removalViolation(
  words: readonly string[],
  dialect: Dialect,
  cwd: string | undefined,
  context: GuardContext,
): Violation | undefined {
  const program = programName(words[0] ?? '');
  const args = words.slice(1);
  const targets =
    dialect === 'powershell' && REMOVE_ITEM.has(program)
      ? removeItemTargets(args)
      : dialect === 'bash' && program === 'rm'
        ? rmTargets(args)
        : [];
  const outside = targets.find((target) => {
    const resolved = resolveTarget(target, cwd, context.home);
    return resolved !== undefined && !isStrictlyInside(resolved, context.projectRoot);
  });
  if (outside === undefined) return undefined;
  return {
    id: 'OLDMAN-G03',
    message: `recursively force-deleting ${outside} reaches outside this project (or deletes the project itself). Delete only paths inside the project, or ask the user to run it themselves.`,
  };
}
