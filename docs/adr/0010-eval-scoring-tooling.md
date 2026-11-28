# 0010. Keep eval tasks checkable: shared helpers, a safe npm cache, verify and refresh commands

Date: 2026-11-27
Status: Accepted

## Context

With 20 build tasks (ADR 0009), a few problems came up that would skew or slow the published numbers:

- Three tasks tested expiry by faking `Date` in the hidden tests. A correct solution that compares times with the database's `now()` would fail them.
- Each scored run installed its dependencies twice from scratch, about 75 seconds of a 3 to 4 minute run. The full benchmark is 120 scored runs.
- Checking the tasks themselves (each starter fails its hidden tests, each reference passes them) was done by hand, and any change to the shared starter would have needed it again for every task, with every reference patch possibly no longer applying.
- `tsc` alone misses what only `next build` checks, such as a wrong route handler signature.
- A scoring session killed outright left its containers running.
- The hidden helper file was copied into every task.

## Decision

- Hidden helpers shared by a base live in `evals/hidden-support/<base>/` and are copied in before each task's hidden tests. They include `ageDatabase(ms)`, which moves every stored timestamp back, so expiry tests hold whichever clock the code uses.
- Scoring uses a shared npm cache volume. A trusted container fills it from the starters alone before scoring, with no run's code present. Scoring containers mount it read-only and copy it in, so code a run leaves behind can never write to the cache that another run installs from. The finished project starts from the untouched starter's `node_modules`, which only our code has run in. Together this cuts the two installs from about 75 seconds to about 20.
- Scoring runs `next build` for Next.js projects, after migrations and before the hidden tests are copied in (the build type-checks every file `tsconfig` includes). The `buildFailed` metric records it.
- Every container the evals start is labelled with its owner process. Runs and scoring first remove labelled containers and Compose projects whose owner has exited.
- `pnpm --filter evals run verify-tasks` scores each task's starter and reference exactly like a run and fails on any wrong pass rate or finding. A task may include `reference.md`, used as the reference's final message, as a run's summary would be.
- `pnpm --filter evals run refresh-patches` moves reference patches onto a changed starter with a git cherry-pick in a scratch repository, and reports real conflicts. It runs in a container with the repository mounted read-only and no network, because the runner's only process is `docker` (a test enforces this).

## Consequences

- A change to a starter is now: edit it, run `refresh-patches` (before committing, so `HEAD` is the old starter), fix any conflicts, then run `verify-tasks`.
- The npm cache volume persists between sessions; deleting it only makes the next session slower.
- Results gain a `buildFailed` metric; the results schema version stays 1 because no results have been published yet.
- `ageDatabase` cannot age timestamps stored as plain numbers. The prompts and the starter use Prisma `DateTime`, so none of the current tasks do that.
