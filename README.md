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

## Checks after each edit

After each Write or Edit, theoldman checks the lines Claude added for change-narration comments, commented-out code, TODOs with no issue or owner, banner comments, `any`, `console.log`, empty `catch` blocks and `debugger`. Findings are listed as `OLDMAN-C01 src/a.ts:12 <message>` and Claude is asked to fix them. Some, like comments that repeat the code, are passed on as warnings only. After `maxFeedbackRounds` requests per kind of check (default 2) in a session, theoldman stops asking and records what is left. Session state lives in `.theoldman/`, which contains its own `.gitignore`, so git ignores it without changes to yours. Use `disable` and `ignorePaths` in `.theoldman.json` to turn rules or paths off.

## What the guard does not catch

The guard reads each command before it runs and blocks the risky ones: force-push or deleting `main`, `--no-verify`, `rm -rf` outside the project, and resets of a database that is not local. It also looks inside `bash -c`, `cmd /c` and `pwsh -Command` (including `-EncodedCommand`), follows `cd` on the same line, and reads the `package.json` scripts that `npm run`, `pnpm` or `yarn` would start.

It catches honest mistakes, not deliberate evasion. It reads text and does not run a shell, so it cannot see:

- values only known at run time: variables (`rm -rf "$DIR"`), aliases, shell functions and `eval` or `Invoke-Expression` on strings built at run time;
- what script files do (`./reset.sh`, `pwsh -File deploy.ps1`);
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

The bundles in `plugin/scripts` are committed, because the plugin installs from git with no build step. Run `pnpm build` after changing hook code and commit the result.

## Docs

- [Decisions](docs/adr/)

## License

MIT
