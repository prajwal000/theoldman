# 0002. No runtime dependencies and no network calls in hook scripts

Date: 2026-11-25
Status: Accepted

## Context

Hook scripts execute automatically on users' machines with access to their source code. Every third-party package is supply-chain risk, and every network call is a possible data leak. Users must be able to read exactly what runs.

## Decision

Hook scripts use Node built-ins only. They make no network calls.

The only process a hook script may start is local `git`, to read `HEAD` content, diffs and the default branch. It is called only as `execFileSync('git', [...])`: the binary is the literal `'git'`, arguments are an array, and the `shell` option is never set. Values from hook input are passed as separate array elements after `--` or inside a `<rev>:<path>` argument, never in an option position. Git subcommands that reach the network (`fetch`, `pull`, `push`, `clone`, `ls-remote`, `remote`) are never called.

A test scans the bundles and fails on forbidden modules (`http`, `https`, `net`, `tls`, `dgram`, `dns`, `worker_threads`), on any `child_process` use other than `execFileSync('git', [...])` without `shell`, and on `fetch(`, `eval(` and `new Function(`.

## Consequences

- Git reads repository config, so a hostile config (for example `core.fsmonitor`, or lazy fetches in a partial clone) could run a command or reach the network. Every git call goes through one helper that passes `--no-pager -c core.fsmonitor=false -c protocol.allow=never` and sets `GIT_NO_LAZY_FETCH=1`, `GIT_TERMINAL_PROMPT=0` and `GIT_OPTIONAL_LOCKS=0`. `protocol.allow=never` blocks every transport, so lazy fetches cannot reach the network even on git versions that ignore `GIT_NO_LAZY_FETCH`. File content is read with `git cat-file blob`, which applies no textconv or filter drivers from repo config. A test sets a hostile `core.fsmonitor` and checks that it does not run.

- Validation, glob matching and parsing are hand-written and kept small.
- The comment extractor is a best-effort tokenizer, not a full parser; known gaps are documented as test todos.
- Trust story for the README and site: "nothing leaves your machine."
- Exception requires a new ADR.
