<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/banner-dark.svg">
    <img alt="theoldman: every line reviewed before it ships" src=".github/assets/banner-light.svg" width="100%">
  </picture>
</p>

# theoldman

Senior-developer rules, guards and reviews for Claude Code.

> Status: in development. Not ready for use yet.

theoldman is a Claude Code plugin. Once installed, every request in Claude Code goes through it:

- **Builder:** Claude writes code that follows senior-dev rules: no filler comments, strict types, tests, docs kept in sync.
- **Guard:** risky actions are blocked before they run: secrets in files, edits to `.env`, force-push to `main`, destructive database commands.
- **Reviewer:** before Claude says "done", the change is reviewed and only confirmed issues are sent back to fix. The same review runs on pull requests in CI.

Nothing leaves your machine. The hook scripts have no dependencies and make no network calls.

## Install

Requires Claude Code 2.1.332 or later and Node 22.13+.

```text
/plugin marketplace add prajwal000/theoldman
/plugin install theoldman@theoldman
/theoldman:init
```

## Commands

| Command             | What it does                                                                                                                                                                                                                           |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/theoldman:init`   | Writes `.theoldman.json` with the stack found in `package.json`, and adds a short theoldman section to `CLAUDE.md`. Never overwrites either.                                                                                           |
| `/theoldman:review` | Reviews the current branch against the default branch, uncommitted work included, with the reviewer and verifier subagents, and reports the confirmed findings. Add "and fix them" to have Claude fix the Critical and Important ones. |
| `/theoldman:docs`   | Checks the README, `.env.example`, ADRs and CHANGELOG against the code and proposes fixes.                                                                                                                                             |
| `/theoldman:off`    | Pauses the rules, edit checks and review for this project. The guards stay on.                                                                                                                                                         |
| `/theoldman:on`     | Turns them back on.                                                                                                                                                                                                                    |

`init`, `off` and `on` only run when you type them: Claude cannot start them, and the guard blocks it from pausing or resuming theoldman any other way (OLDMAN-G08). The first time you run a command that starts a script, Claude Code asks you to allow it.

## Rules at session start and with each prompt

When a session starts, and again after `/clear` or compaction, theoldman gives Claude a short summary of the core rules and the stack it found in `package.json`. Set `stack` in `.theoldman.json` to override the detected stack. At level `quick` the summary is left out.

With each prompt, a keyword router picks up to two topics (auth, db, api, infra, tests, git, docs, ui) and adds at most four rule lines for them. A prompt like "thanks" gets nothing. The router makes no model call.

The full rules are in skills that Claude loads when a task needs them: `oldman-rules` for every change, plus `oldman-security`, `oldman-database`, `oldman-testing`, `oldman-docs` and `oldman-git`.

## Checks after each edit

After each Write or Edit, theoldman checks the lines Claude added for change-narration comments, commented-out code, TODOs with no issue or owner, banner comments, `any`, `console.log`, empty `catch` blocks and `debugger`. Findings are listed as `OLDMAN-C01 src/a.ts:12 <message>` and Claude is asked to fix them. Some, like comments that repeat the code, are passed on as warnings only. After `maxFeedbackRounds` requests per kind of check (default 2) in a session, theoldman stops asking and records what is left. Session state lives in `.theoldman/`, which contains its own `.gitignore`, so git ignores it without changes to yours. Use `disable` and `ignorePaths` in `.theoldman.json` to turn rules or paths off.

## Review before Claude finishes

When Claude stops after changing code, theoldman writes the session's diff to `.theoldman/state/<session>/diff.patch` and asks Claude once to have it reviewed. How much review depends on the change:

- **Docs or tests only:** no review. The exception is a test change that removes lines or skips tests, which gets a light review.
- **Small code change:** a light review. Claude re-reads the diff itself against a short checklist, with no subagents. "Small" means at most `review.lightMaxLines` added and removed lines (default 40; `0` turns light reviews off).
- **Larger change:** the `oldman-reviewer` subagent reports findings. If it finds any, the `oldman-verifier` subagent keeps only the ones it can confirm in the code. Claude then fixes the confirmed Critical and Important ones.

Both subagents can only read files, and they get only the topic rules (security, database, testing, docs) that fit the changed files and your prompts. The same step checks the diff for variables missing from `.env.example`, and notes route, dependency and setup changes that have no matching docs.

Only this session's changes count, including edits made through Bash; uncommitted work from before the session, `.theoldman.json` and paths in `ignorePaths` are left out. theoldman asks at most `maxFeedbackRounds` times per session and never twice for the same diff. Set `"review": { "onStop": false }` or `"level": "quick"` in `.theoldman.json` to turn the review off. Claude Code shows each review request as a "stop hook problem" notification; that is its label for a Stop hook asking Claude to continue, not an error.

## Settings stay yours

Claude cannot weaken theoldman by changing its settings instead of pausing it. The guard blocks Claude from creating, editing or deleting `.theoldman.json`, anything under `.theoldman/`, Claude Code's `.claude/settings.json`, `.claude/settings.local.json` and `managed-settings.json`, and installed plugins under `.claude/plugins/`. That covers the Write and Edit tools, Bash and PowerShell redirects, and commands that write, move or delete files (OLDMAN-G09). It also blocks Claude from pausing theoldman itself (OLDMAN-G08). Reading these files is still allowed.

To change a setting, edit the file yourself or run `/theoldman:init`. Claude Code's own check stops the Write and Edit tools from changing its settings files, but not a Bash redirect, and not anything in bypass-permissions mode.

## What the guard does not catch

The guard reads each command before it runs and blocks the risky ones: force-push or deleting `main`, `--no-verify`, `rm -rf` outside the project, resets of a database that is not local, and writes to theoldman's and Claude Code's settings. It also looks inside `bash -c`, `cmd /c` and `pwsh -Command` (including `-EncodedCommand`), follows `cd` on the same line, and reads the `package.json` scripts that `npm run`, `pnpm` or `yarn` would start.

It catches honest mistakes, not deliberate evasion. It reads text and does not run a shell, so it cannot see:

- values only known at run time: variables (`rm -rf "$DIR"`), aliases, shell functions and `eval` or `Invoke-Expression` on strings built at run time;
- what script files and inline programs do (`./reset.sh`, `pwsh -File deploy.ps1`, `node -e "..."`), including writing to settings files;
- the remote's default branch when git never recorded it locally; then only `main` and `master` are protected.

It can also block by mistake: a heredoc that contains a blocked command, or `DROP TABLE` text in a line that also runs `psql`.

To limit what Claude can do at all, use Claude Code's [permission settings](https://code.claude.com/docs/en/permissions) and [sandbox](https://code.claude.com/docs/en/sandboxing). Those are the security boundary; the guard is a safety net on top of them.

## Development

Requires Node 22.13+ and pnpm.

```text
pnpm install
pnpm check    # lint, typecheck, tests, and a check that plugin/scripts is up to date
pnpm build    # bundles packages/hooks into plugin/scripts
```

`examples/next-prisma-starter` is a small Next.js and Prisma app for trying theoldman end to end; its `SMOKE.md` has the prompts.

The evals in `evals/` measure Claude Code with and without theoldman. Tasks live in `evals/tasks/` (see `_template/README.md`). Check a task without running Claude with `pnpm --filter evals run eval --task _template --condition with --runs 1 --dry-run`; it needs `ANTHROPIC_API_KEY`, or `CLAUDE_CODE_USE_BEDROCK=1` with `AWS_REGION` and AWS credentials, and writes the planned run to `evals/runs/`. For a run you will not publish, `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token` works instead of an API key and uses your Claude subscription; `--publish` refuses it. Without `--dry-run` it needs Docker with Linux containers: it builds the agent image, runs Claude Code in a fresh container per run, and saves each run's transcript, diff and `run.json` (time, turns, cost and tokens per model) to `evals/runs/`, with credential values removed.

The bundles in `plugin/scripts` are committed, because the plugin installs from git with no build step. Run `pnpm build` after changing hook code and commit the result.

## Docs

- [Decisions](docs/adr/)

## License

MIT
