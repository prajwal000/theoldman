# Rule lines for the Tell hooks

The theoldman hooks give Claude the bullet lines under these headings: `core` at the start of every session, and the lines of up to two categories (at most four lines in all) with each prompt the router puts in those categories. List the most important line of each category first. Keep each line short and in line with `SKILL.md` in this folder, which has the full rules. Text outside the bullet lists, like this paragraph, is not sent.

## core

- Comments say why, never what. No change narration, commented-out code, banner comments, or TODO without an issue (`TODO(#123)`).
- Read neighbouring files first and match their patterns. Make the smallest change that solves the task; no drive-by refactors.
- Strict types: no `any`, no unchecked casts, no `!` without a reason. Validate external input at the boundary.
- No empty `catch`, no swallowed promise rejections, no leftover `console.log` or `debugger`.
- Every external call has a timeout, every list query has a limit, and multi-tenant queries are scoped to the tenant.
- No secrets, keys or real personal data in code, tests, fixtures or logs.
- Handle `null` and `undefined` explicitly. Watch units (s and ms, minor and major currency, UTC and local). No floating point for money. Await every promise.
- Every route checks authentication and ownership. Parameterised queries only. Escape output.
- Migrations are backward compatible. Paginate queries, no queries in loops, and use a transaction for multi-step writes.
- New behaviour gets a test; a bug fix gets a test that fails without the fix. Never weaken, skip or delete a test to make it pass.
- Keep README, `.env.example`, ADRs and CHANGELOG true when behaviour changes.
- One logical change per commit, in Conventional Commits; the body says why. Never force-push a shared branch.
- If a wrong guess is expensive, ask one clear question first. If something could break production, say it first.
- When done, report in 3 to 5 lines: what changed, what was tested, what is risky or left.

## auth

- Every route checks authentication and that the user owns the resource (no IDOR).
- Hash passwords with bcrypt or argon2. Sessions and JWTs expire.
- Cookies are `HttpOnly`, `Secure` and `SameSite`. No tokens, passwords or personal data in logs.

## db

- Migrations are backward compatible (expand, migrate, contract); destructive changes need a rollback plan.
- No unbounded `findMany` or `SELECT`: paginate. No queries inside loops (N+1).
- Use a transaction for multi-step writes. Add indexes for new query patterns on large tables.
- Parameterised queries only. No string-built SQL.

## api

- Validate the body, params and query at the boundary (Zod or equivalent).
- Every route checks authentication and that the user owns the resource.
- Every external call has a timeout. Every list endpoint has a limit.
- Update the API docs when an endpoint changes.

## infra

- No secrets in Dockerfiles, CI files or committed config.
- Every new environment variable goes in `.env.example`.
- If a change could break production, say so first.

## tests

- New behaviour gets a test; a bug fix gets a test that fails without the fix.
- Test edge cases and failure paths, not only the happy path.
- Never weaken, skip or delete a test to make it pass. Do not mock the unit under test.

## git

- One logical change per commit, in Conventional Commits; the body says why, not what.
- Never commit `.env`, build output, coverage or large binaries.
- Never force-push a shared branch, commit straight to `main`, or skip hooks with `--no-verify`.

## docs

- The README stays true: what it is, setup in under 5 commands, env vars, tests, deploy.
- Update `.env.example`, the CHANGELOG and API docs with the change. Add an ADR for decisions someone will ask "why?" about.
- Write plainly and briefly. No marketing words, no emoji.

## ui

- Match the existing components, styles and naming before adding new ones.
- Escape output. No `dangerouslySetInnerHTML` with user data.
- Reuse existing utilities and components before adding a package.
