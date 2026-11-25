// Guard rules for commands run through the Bash and PowerShell tools.
//
// OLDMAN-G01 blocks a force-push (-f, --force, --force-with-lease, +refspec, --mirror) to main,
// master or the remote's default branch. OLDMAN-G02 blocks skipping git hooks with
// `git commit --no-verify` / `-n` and `git push --no-verify`. OLDMAN-G03 (guard-rm.ts) blocks
// recursive forced deletes outside the project; OLDMAN-G04 (guard-db.ts) blocks destructive
// database commands unless the database is local.
//
// Known gaps (this reads commands, it does not run a shell):
// - Commands built at run time are not seen: variables, aliases, functions, scripts, `eval`,
//   `sh -c "..."`, `Invoke-Expression`, and command substitution inside double quotes.
// - Abbreviated long options (`--no-verif`), `git -c alias.x=...`, and `env -u NAME` are not
//   resolved. `git push --delete main` is not a force-push and is not blocked here.
// - Heredoc bodies are read as commands, so a heredoc that contains a blocked command is blocked.
// - The default branch comes from the local `refs/remotes/<remote>/HEAD`; it is unknown if that
//   ref was never set, and then only main and master are protected.
// - Delete targets are resolved against the hook's working directory, so a `cd` earlier in the
//   same command line is ignored; targets that use a variable other than the home directory
//   (`rm -rf "$DIR"`) cannot be resolved and are allowed.
// - Destructive SQL is matched anywhere in a command line that also runs psql or mysql, so
//   `echo "DROP TABLE t" && psql -c "SELECT 1"` is treated as destructive. npm scripts that
//   wrap these commands (`npm run db:reset`) are not seen.

import type { Finding, Rule } from '../lib/rules.js';
import { type Dialect, parseCommands, programName } from '../lib/shell.js';
import { commitSkipsHooks, gitInvocation, parsePush, refspecTarget } from './git-args.js';
import type { GitContext, GuardContext, Violation } from './guard-context.js';
import { databaseViolation } from './guard-db.js';
import { removalViolation } from './guard-rm.js';

export type { GitContext, GuardContext, Violation } from './guard-context.js';

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

function gitViolations(words: readonly string[], git: GitContext): (Violation | undefined)[] {
  const invocation = programName(words[0] ?? '') === 'git' ? gitInvocation(words) : undefined;
  const { subcommand, args = [] } = invocation ?? {};
  if (subcommand === 'push') {
    return [forcePushViolation(args, git), args.includes('--no-verify') ? skipHooks : undefined];
  }
  return [subcommand === 'commit' && commitSkipsHooks(args) ? skipHooks : undefined];
}

/** Every guard violation in a command line, at most one per rule, in order of appearance. */
export function checkCommand(text: string, dialect: Dialect, context: GuardContext): Violation[] {
  const commands = parseCommands(text, dialect);
  const found = new Map<string, Violation>();
  const violations = [
    ...commands.flatMap(({ words }) => [
      ...gitViolations(words, context),
      removalViolation(words, dialect, context),
    ]),
    databaseViolation(text, commands, context),
  ];
  for (const violation of violations) {
    if (violation !== undefined && !found.has(violation.id)) found.set(violation.id, violation);
  }
  return [...found.values()];
}

/** The guard as a Rule for fixtures: one command per line, `.ps1` files read as PowerShell. */
export function guardBashRule(context: GuardContext): Rule {
  return ({ file, addedLines }) => {
    const dialect: Dialect = file.endsWith('.ps1') ? 'powershell' : 'bash';
    return addedLines.flatMap(({ line, text }) =>
      checkCommand(text, dialect, context).map((v): Finding => ({
        ...v,
        action: 'block',
        file,
        line,
      })),
    );
  };
}
