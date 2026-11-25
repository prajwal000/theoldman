// Guard rules for commands run through the Bash and PowerShell tools.
//
// OLDMAN-G01 blocks a force-push (-f, --force, --force-with-lease, +refspec, --mirror) to main,
// master or the remote's default branch. OLDMAN-G02 blocks skipping git hooks with
// `git commit --no-verify` / `-n` and `git push --no-verify`.
//
// Known gaps (this reads commands, it does not run a shell):
// - Commands built at run time are not seen: variables, aliases, functions, scripts, `eval`,
//   `sh -c "..."`, `Invoke-Expression`, and command substitution inside double quotes.
// - Abbreviated long options (`--no-verif`), `git -c alias.x=...`, and `env -u NAME` are not
//   resolved. `git push --delete main` is not a force-push and is not blocked here.
// - Heredoc bodies are read as commands, so a heredoc that contains a blocked command is blocked.
// - The default branch comes from the local `refs/remotes/<remote>/HEAD`; it is unknown if that
//   ref was never set, and then only main and master are protected.

import type { Finding, Rule } from '../lib/rules.js';
import { type Dialect, programName, splitCommands } from '../lib/shell.js';
import { commitSkipsHooks, gitInvocation, parsePush, refspecTarget } from './git-args.js';

export interface GitContext {
  currentBranch(): string | undefined;
  defaultBranch(remote: string): string | undefined;
}

export interface Violation {
  readonly id: 'OLDMAN-G01' | 'OLDMAN-G02';
  readonly message: string;
}

const forcePush = (target: string): Violation => ({
  id: 'OLDMAN-G01',
  message: `force-pushing to ${target} rewrites history others depend on. Push to a new branch and open a pull request, or ask the user to run the force-push themselves.`,
});

const skipHooks: Violation = {
  id: 'OLDMAN-G02',
  message:
    '--no-verify skips the git hooks that check this repo. Fix what the hook reports, then commit or push without --no-verify.',
};

function forcePushViolation(args: readonly string[], git: GitContext): Violation | undefined {
  const { force, allBranches, remote, refspecs } = parsePush(args);
  if (allBranches) {
    return force ? forcePush('every branch, including the default branch') : undefined;
  }
  // With no refspec git pushes the current branch; a `+` forces one refspec even without -f.
  const forced =
    refspecs.length > 0
      ? refspecs.filter((s) => force || s.startsWith('+'))
      : force
        ? ['HEAD']
        : [];
  const targets = forced
    .map(refspecTarget)
    .map((t) => (t === 'HEAD' || t === '@' ? git.currentBranch() : t));
  const protectedTarget = targets.find(
    (branch) =>
      branch !== undefined &&
      branch !== '' &&
      (branch === 'main' || branch === 'master' || branch === git.defaultBranch(remote)),
  );
  return protectedTarget === undefined ? undefined : forcePush(protectedTarget);
}

/** Every G01 and G02 violation in a command line, at most one of each, in order of appearance. */
export function checkCommand(text: string, dialect: Dialect, git: GitContext): Violation[] {
  const found = new Map<string, Violation>();
  for (const words of splitCommands(text, dialect)) {
    const invocation = programName(words[0] ?? '') === 'git' ? gitInvocation(words) : undefined;
    const { subcommand, args = [] } = invocation ?? {};
    const violations =
      subcommand === 'push'
        ? [forcePushViolation(args, git), args.includes('--no-verify') ? skipHooks : undefined]
        : [subcommand === 'commit' && commitSkipsHooks(args) ? skipHooks : undefined];
    for (const violation of violations) {
      if (violation !== undefined && !found.has(violation.id)) found.set(violation.id, violation);
    }
  }
  return [...found.values()];
}

/** The guard as a Rule for fixtures: one command per line, `.ps1` files read as PowerShell. */
export function guardBashRule(git: GitContext): Rule {
  return ({ file, addedLines }) => {
    const dialect: Dialect = file.endsWith('.ps1') ? 'powershell' : 'bash';
    return addedLines.flatMap(({ line, text }) =>
      checkCommand(text, dialect, git).map((v): Finding => ({ ...v, action: 'block', file, line })),
    );
  };
}
