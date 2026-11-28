# Task template

Copy this folder to `evals/tasks/<id>/` to add a task. The folder name is the task ID: lowercase letters, digits, `-` and `_`. Add a row for it to `evals/tasks/README.md`; a test fails until you do.

- `task.json`: `title`, `base` and/or `starter` (see below), `hiddenTests` (folder), `timeoutMinutes` (1 to 60) and `services` (a list; `postgres` is the only one so far).
- `prompt.md`: the prompt Claude gets, as a user would write it. Name the routes, fields and status codes the hidden tests rely on.
- The starter, the project Claude starts from: `base` names a shared app in `evals/starters/` (such as `next-prisma`), and `starter` names a folder in the task that is copied over it, for files a task adds or changes. Either one alone works too; this template uses `starter` alone. Scoring installs its dependencies and counts errors with `tsc --noEmit -p .` (needs `tsconfig.json` and `typescript`) and `eslint .` (needs an `eslint.config.*` file and `eslint`), runs `next build` when Next.js is installed, and runs the tests with `vitest run` (needs `vitest`). Pin exact versions in its `package.json` so every run scores against the same tools. A run records a hash of the starter; changing it afterwards, base included, makes that run's diff unscorable.
- `hidden/`: tests Claude never sees. They mirror the project layout and are copied over the project before the tests run, so `hidden/src/math.hidden.test.ts` lands next to `src/math.ts`. vitest's default file pattern must find them. They must load and fail on the untouched starter: scoring runs them there first and takes each file's test count from that run, so a run that breaks a hidden file's imports still fails all of its tests. Import modules the task creates inside the tests (`await import(...)`), so a missing module fails each test instead of the whole file.
- Shared hidden helpers: for a task on a base, `evals/hidden-support/<base>/` is copied in before the task's hidden tests. For `next-prisma` it holds `test/hidden/support.ts` (`resetDatabase`, `createUser`, `call`, `params` and `ageDatabase`). To test that something expires, call `ageDatabase(ms)`, which moves every stored timestamp back, instead of faking `Date`: a solution may compare times with the database's clock.
- Component tests: the `next-prisma` base has jsdom, `@testing-library/react` and `@testing-library/user-event`. Start such a test file with `// @vitest-environment jsdom` and call `cleanup()` after each test, since Vitest globals are off.
- `expected.md`: what a careful senior developer would do, split into what the hidden tests check and what reviewers look for beyond them.
- `reference.patch`: a solution, as a diff against the starter. `reference.md` (optional) is what its author would say in a run's final message, such as why it adds a dependency; scoring the reference uses it as Claude's summary.

With `services: ["postgres"]`, runs and scoring get a fresh database as `DATABASE_URL`. Scoring deploys the project's Prisma migrations (`prisma migrate deploy`) before `next build` and the tests, so a schema change without a migration fails, as it would fail a deploy.

Scoring also counts Semgrep and gitleaks findings on the lines the run added, the tests the run added to the project's own suite, and theoldman's docs rule findings (OLDMAN-D01 to D04) on the run's diff.

Check a task without running Claude:

```text
pnpm --filter evals run eval --task <id> --condition with --runs 1 --dry-run
```

Check that the starter fails every hidden test and the reference passes them with no findings, scored like a run (Docker, no model provider):

```text
pnpm --filter evals run verify-tasks -- <id>
```

After changing a starter, move the reference patches onto it, then verify:

```text
pnpm --filter evals run refresh-patches
pnpm --filter evals run verify-tasks
```

Score finished runs, by the folder names the runner printed:

```text
pnpm --filter evals run score -- <run folder> <run folder>
```
