# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Plugin manifest and marketplace, installable with `/plugin install theoldman@theoldman`.
- `oldman-rules` skill with the core rules for writing and reviewing code.
- Guard hooks that block risky actions before they run, from both the Bash and PowerShell tools:
  - force-pushing or deleting `main`, `master` or the remote's default branch (OLDMAN-G01);
  - skipping git hooks with `--no-verify` (OLDMAN-G02);
  - `rm -rf` or `Remove-Item -Recurse -Force` outside the project (OLDMAN-G03);
  - destructive database commands against a database that is not local (OLDMAN-G04);
  - writing `.env` files (except `.env.example`) or private key files (OLDMAN-G05, OLDMAN-G06);
  - secrets in written files or in commands, reported without repeating the secret (OLDMAN-S01).
- A check hook that runs after each Write or Edit on the added lines and asks Claude to fix change-narration comments, commented-out code, TODOs with no issue or owner, banner comments, `any`, `console.log`, empty `catch` blocks and `debugger` (OLDMAN-C01 to OLDMAN-C06, OLDMAN-Q01 to OLDMAN-Q04). Comments that repeat the code and comment-heavy blocks are warnings only. It stops asking after `maxFeedbackRounds` per check type and records the rest.
- A session-start hook that gives Claude a short summary of the core rules and the project's stack, read from `package.json` or from `stack` in `.theoldman.json`. At level `quick`, or while paused, it sends a one-line notice instead.
- Session state is kept in `.theoldman/`, which holds its own `.gitignore` so git ignores it without changes to the project's `.gitignore`.
- The command guard also checks `bash -c`, `cmd /c` and `pwsh -Command` strings, `package.json` scripts started with `npm run`, `pnpm` or `yarn`, and `cd` earlier on the same line. Turn any rule off with `disable` in `.theoldman.json`.
