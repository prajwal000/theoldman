# 0009. Build tasks share one starter app and are checked against reference solutions

Date: 2026-11-27
Status: Accepted

## Context

The build-mode evals need 20 to 30 tasks on a Next.js, Prisma and Postgres project. Each task needs a starter, a prompt and hidden tests that fail on the starter. A score is only as good as its hidden tests: a test that cannot pass, or that passes on the untouched starter, says nothing about Claude.

Copying a full Next.js app into every task would mean 20+ near-identical copies to keep in step. The hidden tests need a database, and a scored project must reach the same schema it would reach in production.

## Decision

- Tasks share one base app, `evals/starters/next-prisma/`: a small shop API (accounts and sessions, products, orders) with tests, a README and its first migration. `task.json` names it as `base`. An optional `starter` folder in the task is copied over it for task-specific files, such as a planted bug. The run's starter hash covers the merged files.
- Hidden tests call the Next.js route handlers directly with `Request` objects, against a real Postgres, so no server runs. Prompts name the routes, fields and status codes the tests rely on. Modules a task creates are imported inside each test, so on the starter each test fails on its own and the file still reports its test count.
- Scoring starts a fresh Postgres per scored run, from the same compose file and pinned image as the runs, and runs `prisma migrate deploy` before each test run: the untouched starter in one database, the finished project in another. A schema change without a migration fails the tests that need it, as it would fail a deploy.
- Each task commits a `reference.patch`. Scoring it like a run must give a hidden-test pass rate of 1, and the untouched starter 0. A unit test checks that each patch still applies to its starter.
- Each task has `expected.md`: what the hidden tests check, and what a careful senior developer would also do (hashing tokens, constant-time signature checks, migrations, docs), for reviewing runs.

## Consequences

- Changing the base app changes the starter of every task that uses it, so earlier runs of those tasks can no longer be scored against it. Base changes should be rare and land before a set of published runs.
- Scoring a database task takes a few minutes per run: two dependency installs, two migration deploys and two test runs.
- Reference solutions are public, as is everything in this repository. Runs never see them: only the starter is copied into the agent's container.
- Hidden tests depend on the base app's `src/lib/db.ts` and `src/lib/auth.ts`. A run that rewrites those can fail hidden tests for that reason, which is a real regression in this app.
