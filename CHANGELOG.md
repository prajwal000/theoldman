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
  - secrets in written files or in commands, reported without repeating the secret (OLDMAN-S01);
  - the model pausing or resuming theoldman itself, by running its pause script or touching its paused flag (OLDMAN-G08); only the user can, with `/theoldman:off` and `/theoldman:on`;
  - the model creating, editing or deleting theoldman's or Claude Code's settings: `.theoldman.json`, anything under `.theoldman/`, `.claude/settings.json`, `.claude/settings.local.json`, `managed-settings.json` and `.claude/plugins/`, through Write/Edit, redirects or file commands (OLDMAN-G09); reading them is allowed;
  - writes by the `theoldman:oldman-docs-writer` subagent outside README and CHANGELOG files, root `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md` and `SUPPORT.md`, Markdown under `docs/`, `.env.example` and OpenAPI files (OLDMAN-G07). Agent instruction and config files (`CLAUDE.md`, `AGENTS.md`, `REVIEW.md`, `.claude/`, `.github/`, `.theoldman.json`, `LICENSE`) are always blocked for it, because editing them could persist a prompt injection.
- A check hook that runs after each Write or Edit on the added lines and asks Claude to fix change-narration comments, commented-out code, TODOs with no issue or owner, banner comments, `any`, `console.log`, empty `catch` blocks and `debugger` (OLDMAN-C01 to OLDMAN-C06, OLDMAN-Q01 to OLDMAN-Q04). Comments that repeat the code and comment-heavy blocks are warnings only. It stops asking after `maxFeedbackRounds` per check type and records the rest.
- A session-start hook that gives Claude a short summary of the core rules and the project's stack, read from `package.json` or from `stack` in `.theoldman.json`. At level `quick`, or while paused, it sends a one-line notice instead.
- A prompt router that puts each prompt into up to two categories by keyword (auth, db, api, infra, tests, git, docs, ui) and gives Claude at most four matching rule lines. Prompts that match no category get nothing.
- Topic skills with the full rules for security, database, testing, docs and git (`oldman-security`, `oldman-database`, `oldman-testing`, `oldman-docs`, `oldman-git`), loaded by Claude when a task needs them.
- Review subagents: `theoldman:oldman-reviewer` reviews a diff file and reports findings with severity, `file:line`, a failure scenario and a fix, and reports instructions hidden in code as possible prompt injection; `theoldman:oldman-verifier` keeps only findings it can confirm by quoting the code. Both can only read files. `theoldman:oldman-docs-writer` fixes README, ADR, CHANGELOG and `.env.example` gaps, and is blocked from writing other files (OLDMAN-G07).
- A Stop hook that reviews the session's changes before Claude finishes. When code changed, it writes the diff to `.theoldman/state/<session>/diff.patch` and asks Claude once to run the reviewer and verifier subagents on it and fix confirmed Critical and Important findings. It also checks the diff for missing `.env.example` entries (OLDMAN-D01, Fix) and for route, dependency and setup changes without matching docs (OLDMAN-D02 to OLDMAN-D04, notes); a README edit that mentions a changed route's URL counts as its docs. Changes made through Bash count; uncommitted work from before the session does not. It never loops: it stays quiet while Claude is finishing what it asked for, asks at most `maxFeedbackRounds` times per session, and tells the user once when it skips a review. Docs-only and tests-only changes are not reviewed. Code changes of at most `review.lightMaxLines` lines (default 40) get a light self-review without subagents. The verifier runs only when the reviewer found something, and both subagents get only the topic rules that fit the change. Level `quick` and `review.onStop: false` turn the review off. theoldman's own `.theoldman.json` and paths in `ignorePaths` are not reviewed.
- Commands:
  - `/theoldman:init` writes `.theoldman.json` with the detected stack and adds a short theoldman section to `CLAUDE.md`, without overwriting either;
  - `/theoldman:review` reviews the current branch against the default branch with the reviewer and verifier subagents;
  - `/theoldman:docs` audits the README, `.env.example`, ADRs and CHANGELOG and proposes fixes;
  - `/theoldman:off` and `/theoldman:on` pause and resume the rules, edit checks and review; the guards stay on.

  `init`, `off` and `on` can only be run by the user.

- Session state is kept in `.theoldman/`, which holds its own `.gitignore` so git ignores it without changes to the project's `.gitignore`.
- The command guard also checks `bash -c`, `cmd /c` and `pwsh -Command` strings, `package.json` scripts started with `npm run`, `pnpm` or `yarn`, and `cd` earlier on the same line. Turn any rule off with `disable` in `.theoldman.json`.
