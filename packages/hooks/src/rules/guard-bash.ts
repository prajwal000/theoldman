// Guard rules for commands run through the Bash and PowerShell tools.
//
// OLDMAN-G01 blocks a force-push (-f, --force, --force-with-lease, +refspec, --mirror) to main,
// master or the remote's default branch, and deleting one of them on the remote. OLDMAN-G02
// blocks skipping git hooks (`commit --no-verify` / `-n`, `push --no-verify`). OLDMAN-G03
// (guard-rm.ts) blocks recursive forced deletes outside the project; OLDMAN-G04 (guard-db.ts)
// blocks destructive database commands unless the database is local. OLDMAN-G08 (guard-pause.ts)
// blocks running theoldman's pause script or touching its paused flag; OLDMAN-G09
// (guard-config.ts) blocks writing theoldman's or Claude Code's settings. OLDMAN-S01 (secrets.ts)
// blocks a secret in the command text, such as `echo "sk_live_..." > key.txt`, without ever
// repeating it. command-expand.ts also
// checks strings passed to `bash -c`, `cmd /c` and `pwsh -Command` / `-EncodedCommand`, and the
// package.json scripts that `npm|pnpm|yarn run` would start.
//
// It catches honest mistakes, not deliberate evasion. Known gaps (it reads commands, it does
// not run a shell):
// - Values only known at run time: variables (`rm -rf "$DIR"`, `cd $X`), aliases, shell
//   functions, script files (`./reset.sh`, `pwsh -File x.ps1`), `eval` / `Invoke-Expression`
//   on built strings, and command substitution inside double quotes.
// - cmd's own delete commands (`rd /s /q`, `del /s`) are not checked.
// - The default branch comes from the local `refs/remotes/<remote>/HEAD`; if that ref was never
//   set, only main and master are protected.
// - False alarms: heredoc bodies are read as commands, and DROP or TRUNCATE text anywhere in a
//   line that also runs psql or mysql counts as destructive.

import type { Finding, Rule } from '../lib/rules.js';
import type { Dialect } from '../lib/shell.js';
import { programName } from '../lib/shell.js';
import { expandCommands } from './command-expand.js';
import { commitSkipsHooks, gitInvocation, parsePush, refspecTarget } from './git-args.js';
import type { GitContext, GuardContext, Violation } from './guard-context.js';
import { configCommandViolation } from './guard-config.js';
import { databaseViolation } from './guard-db.js';
import { pauseCommandViolation } from './guard-pause.js';
import { removalViolation } from './guard-rm.js';
import { commandSecretMessage, scanSecrets } from './secrets.js';

export type { GitContext, GuardContext, Violation } from './guard-context.js';

const SAFE_ALTERNATIVE = 'or ask the user to run it themselves.';

const forcePush = (target: string): Violation => ({
  id: 'OLDMAN-G01',
  message: `force-pushing to ${target} rewrites history others depend on. Push to a new branch and open a pull request, ${SAFE_ALTERNATIVE}`,
});

const deleteBranch = (target: string): Violation => ({
  id: 'OLDMAN-G01',
  message: `deleting ${target} on the remote removes a branch others depend on. Delete only your own feature branches, ${SAFE_ALTERNATIVE}`,
});

const skipHooks: Violation = {
  id: 'OLDMAN-G02',
  message:
    '--no-verify skips the git hooks that check this repo. Fix what the hook reports, then commit or push without --no-verify.',
};

function pushViolations(args: readonly string[], git: GitContext): (Violation | undefined)[] {
  const push = parsePush(args);
  const isProtected = (branch: string | undefined): branch is string =>
    branch !== undefined &&
    branch !== '' &&
    (branch === 'main' || branch === 'master' || branch === git.defaultBranch(push.remote));
  // `git push origin :main` deletes main, as does `git push --delete origin main`.
  const deleted = push.delete
    ? push.refspecs.map(refspecTarget)
    : push.refspecs.filter((s) => s.startsWith(':')).map(refspecTarget);
  // With no refspec git pushes the current branch; a `+` forces one refspec even without -f.
  const pushed = push.refspecs.filter((s) => !s.startsWith(':'));
  const forced =
    push.refspecs.length > 0
      ? pushed.filter((s) => push.force || s.startsWith('+'))
      : push.force
        ? ['HEAD']
        : [];
  const forcedTargets = forced
    .map(refspecTarget)
    .map((t) => (t === 'HEAD' || t === '@' ? git.currentBranch() : t));
  const deletedTarget = deleted.find(isProtected);
  const forcedTarget = push.allBranches ? undefined : forcedTargets.find(isProtected);
  return [
    push.allBranches && push.force
      ? forcePush('every branch, including the default branch')
      : undefined,
    deletedTarget === undefined ? undefined : deleteBranch(deletedTarget),
    forcedTarget === undefined || push.delete ? undefined : forcePush(forcedTarget),
    push.noVerify ? skipHooks : undefined,
  ];
}

function gitViolations(words: readonly string[], git: GitContext): (Violation | undefined)[] {
  const invocation = programName(words[0] ?? '') === 'git' ? gitInvocation(words) : undefined;
  if (invocation?.subcommand === 'push') return pushViolations(invocation.args, git);
  return [
    invocation?.subcommand === 'commit' && commitSkipsHooks(invocation.args)
      ? skipHooks
      : undefined,
  ];
}

/** Every guard violation in a command line, at most one per rule. */
export function checkCommand(text: string, dialect: Dialect, context: GuardContext): Violation[] {
  const found = new Map<string, Violation>();
  for (const unit of expandCommands(text, dialect, context)) {
    const violations = [
      ...unit.commands.flatMap(({ words, cwd, redirects }) => [
        ...gitViolations(words, context),
        removalViolation(words, unit.dialect, cwd, context),
        pauseCommandViolation(words, redirects),
        configCommandViolation(words, redirects),
      ]),
      databaseViolation(unit, context),
    ];
    for (const violation of violations) {
      if (violation !== undefined && !found.has(violation.id)) found.set(violation.id, violation);
    }
  }
  // The raw text covers secrets anywhere in the line, nested strings included.
  const [secret] = scanSecrets(text);
  if (secret !== undefined)
    found.set('OLDMAN-S01', { id: 'OLDMAN-S01', message: commandSecretMessage(secret) });
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
