// Reads git command-line arguments for the guard rules: which subcommand runs, what a push
// forces or deletes, and whether a commit or push skips hooks. Words come from lib/shell.ts.

import { COMMIT_OPTIONS, longOption, PUSH_OPTIONS } from './git-options.js';

const GLOBAL_OPTIONS_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace']);
const PUSH_OPTIONS_WITH_VALUE = new Set(['repo', 'receive-pack', 'exec', 'push-option']);
const COMMIT_OPTIONS_WITH_VALUE = new Set(
  (
    'message file author date reuse-message reedit-message fixup squash template cleanup ' +
    'trailer pathspec-from-file'
  ).split(' '),
);

export interface GitInvocation {
  readonly subcommand: string;
  readonly args: readonly string[];
}

/** The subcommand of `git [global options] <subcommand> ...`, or undefined if there is none. */
export function gitInvocation(words: readonly string[]): GitInvocation | undefined {
  for (let i = 1; i < words.length; i++) {
    const word = words[i] ?? '';
    if (!word.startsWith('-')) return { subcommand: word, args: words.slice(i + 1) };
    if (GLOBAL_OPTIONS_WITH_VALUE.has(word)) i++;
  }
  return undefined;
}

export interface PushArgs {
  /** -f, --force, --force-with-lease or --mirror: every refspec is forced. */
  readonly force: boolean;
  /** --all, --branches or --mirror: every branch is pushed. */
  readonly allBranches: boolean;
  /** -d or --delete: every refspec names a remote branch to delete. */
  readonly delete: boolean;
  readonly noVerify: boolean;
  readonly remote: string;
  readonly refspecs: readonly string[];
}

export function parsePush(args: readonly string[]): PushArgs {
  const flags = { force: false, allBranches: false, delete: false, noVerify: false };
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? '';
    if (arg === '--') {
      positional.push(...args.slice(i + 1));
      break;
    } else if (arg.startsWith('--')) {
      const name = longOption(arg, PUSH_OPTIONS) ?? '';
      flags.force ||= ['force', 'force-with-lease', 'mirror'].includes(name);
      flags.allBranches ||= ['mirror', 'all', 'branches'].includes(name);
      flags.delete ||= name === 'delete';
      flags.noVerify ||= name === 'no-verify';
      if (PUSH_OPTIONS_WITH_VALUE.has(name) && !arg.includes('=')) i++;
    } else if (arg.startsWith('-') && arg.length > 1) {
      // Short options can be grouped (`-uf`); `-o` takes a value, attached or as the next word.
      const letters = arg.slice(1).split('o')[0] ?? '';
      flags.force ||= letters.includes('f');
      flags.delete ||= letters.includes('d');
      if (arg.endsWith('o')) i++;
    } else {
      positional.push(arg);
    }
  }
  const [remote = 'origin', ...refspecs] = positional;
  return { ...flags, remote, refspecs };
}

/** What a refspec writes to: `main` for `main`, `+main`, `HEAD:main` or `refs/heads/main`. */
export function refspecTarget(refspec: string): string {
  const spec = refspec.replace(/^\+/, '');
  const colon = spec.indexOf(':');
  return (colon === -1 ? spec : spec.slice(colon + 1)).replace(/^refs\/heads\//, '');
}

/** True for `--no-verify` (or a prefix git accepts) or `-n`, also grouped, before any `--`. */
export function commitSkipsHooks(args: readonly string[]): boolean {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? '';
    if (arg === '--') return false;
    if (arg.startsWith('--')) {
      const name = longOption(arg, COMMIT_OPTIONS);
      if (name === 'no-verify') return true;
      if (name !== undefined && COMMIT_OPTIONS_WITH_VALUE.has(name) && !arg.includes('=')) i++;
    } else if (arg.startsWith('-')) {
      // In a group such as `-anm msg`, a value-taking letter ends the group.
      const valueAt = arg.slice(1).search(/[mFCct]/);
      const letters = valueAt === -1 ? arg.slice(1) : arg.slice(1, valueAt + 1);
      if (letters.includes('n')) return true;
      if (valueAt === arg.length - 2) i++;
    }
  }
  return false;
}
