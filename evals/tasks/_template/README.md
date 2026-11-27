# Task template

Copy this folder to `evals/tasks/<id>/` to add a task. The folder name is the task ID: lowercase letters, digits, `-` and `_`.

- `task.json`: `title`, `base` and/or `starter` (see below), `hiddenTests` (folder), `timeoutMinutes` (1 to 60) and `services` (a list; `postgres` is the only one so far).
- `prompt.md`: the prompt Claude gets, as a user would write it. Name the routes, fields and status codes the hidden tests rely on.
- The starter, the project Claude starts from: `base` names a shared app in `evals/starters/` (such as `next-prisma`), and `starter` names a folder in the task that is copied over it, for files a task adds or changes. Either one alone works too; this template uses `starter` alone. Scoring installs its dependencies and counts errors with `tsc --noEmit -p .` (needs `tsconfig.json` and `typescript`) and `eslint .` (needs an `eslint.config.*` file and `eslint`), and runs the tests with `vitest run` (needs `vitest`), so give it all three. Pin exact versions in its `package.json` so every run scores against the same tools. A run records a hash of the starter; changing it afterwards, base included, makes that run's diff unscorable.
- `hidden/`: tests Claude never sees. They mirror the project layout and are copied over the project before the tests run, so `hidden/src/math.hidden.test.ts` lands next to `src/math.ts`. vitest's default file pattern must find them. They must load and fail on the untouched starter: scoring runs them there first and takes each file's test count from that run, so a run that breaks a hidden file's imports still fails all of its tests. Import modules the task creates inside the tests (`await import(...)`), so a missing module fails each test instead of the whole file.
- `expected.md`: what a careful senior developer would do, split into what the hidden tests check and what reviewers look for beyond them.
- `reference.patch`: a solution, as a diff against the starter. Score it like a run to check the hidden tests can pass: its hidden-test pass rate should be 1, and the untouched starter's 0. A test checks that it still applies.

With `services: ["postgres"]`, runs and scoring get a fresh database as `DATABASE_URL`. Scoring deploys the project's Prisma migrations (`prisma migrate deploy`) before each test run, so a schema change without a migration fails the hidden tests, as it would fail a deploy.

Scoring also counts Semgrep and gitleaks findings on the lines the run added, the tests the run added to the project's own suite, and theoldman's docs rule findings (OLDMAN-D01 to D04) on the run's diff.

Check a task without running Claude:

```text
pnpm --filter evals run eval --task <id> --condition with --runs 1 --dry-run
```

Score finished runs, by the folder names the runner printed:

```text
pnpm --filter evals run score -- <run folder> <run folder>
```
