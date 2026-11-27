# Task template

Copy this folder to `evals/tasks/<id>/` to add a task. The folder name is the task ID: lowercase letters, digits, `-` and `_`.

- `task.json`: `title`, `starter` (folder), `hiddenTests` (folder), `timeoutMinutes` (1 to 60) and `services` (a list; `postgres` is the only one so far).
- `prompt.md`: the prompt Claude gets, as a user would write it.
- `starter/`: the project Claude starts from. Scoring installs its dependencies and counts errors with `tsc --noEmit -p .` (needs `tsconfig.json` and `typescript`) and `eslint .` (needs an `eslint.config.*` file and `eslint`), so give it both. Pin exact versions in its `package.json` so every run scores against the same tools. A run records a hash of the starter; changing the starter afterwards makes that run's diff unscorable.
- `hidden/`: tests Claude never sees. They mirror the project layout and are copied over the finished project before scoring, so `hidden/src/math.hidden.test.ts` lands next to `src/math.ts`. They must fail on the untouched starter.

Check a task without running Claude:

```text
pnpm --filter evals run eval --task <id> --condition with --runs 1 --dry-run
```

Score finished runs, by the folder names the runner printed:

```text
pnpm --filter evals run score -- <run folder> <run folder>
```
