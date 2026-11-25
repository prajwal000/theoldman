---
name: oldman-rules
description: Core senior-developer rules for writing, changing and reviewing code. Use whenever you write or edit code, tests or docs, review a diff, or report a finished task.
user-invocable: false
---

# The Old Man's Rules

Write and review code the way a strict senior developer would. Every rule here is short and checkable. When a rule and a request conflict, say so instead of silently breaking the rule.

## 1. Comments: why, never what

Do not write:

- Comments that restate the code: `// increment i`, `// return the user`.
- Change narration: `// Added this to fix the bug`, `// Updated per request`. That belongs in the commit message.
- Commented-out code. Git remembers it.
- `TODO` or `FIXME` without an issue link: use `// TODO(#123): ...`.
- Banner or divider comments: `// ===== HELPERS =====`.

Do write comments for:

- Why a non-obvious choice was made.
- A workaround, with a link to the bug or issue.
- A business rule: `// VAT is 13% (VAT Act 2052)`.
- A performance or security trade-off.

TSDoc or JSDoc only on exported functions, types and public APIs, and only when the name and types are not enough.

```ts
// Bad
// Get the user by id
const user = await getUser(id); // fetch user

// Good
// Prisma returns null for soft-deleted rows; treat them as missing so
// deleted patients never appear in search (see #214).
const user = await getActiveUser(id);
```

## 2. Code

- Read neighbouring files first. Match existing patterns, naming and structure.
- Make the smallest change that solves the task. No drive-by refactors, no speculative options "for later".
- Names explain intent. Functions do one thing. Prefer early returns to deep nesting.
- Strict types: no `any`, no unchecked casts, no `!` without a reason.
- Validate all external input at the boundary (Zod or equivalent).
- No empty `catch`, no swallowed promise rejections, no leftover `console.log` or `debugger`.
- Every external call has a timeout. Every list query has a limit.
- In multi-tenant apps every query is scoped to the tenant.
- No secrets, keys or real personal data in code, tests, fixtures or logs.
- Reuse existing utilities before adding a package. A new package needs a one-line reason.

## 3. Logic and correctness

- Check for off-by-one errors, inverted conditions and wrong comparison operators.
- Handle `null` and `undefined` explicitly; do not hide bugs with optional chaining.
- Watch units: seconds vs milliseconds, minor vs major currency units, UTC vs local time.
- Never use floating point for money.
- Await every promise or handle it deliberately.
- When a function's behaviour changes, find and check every caller.
- Do what the request asked, no more and no less.

## 4. Security

- Every route checks authentication and that the user owns the resource (no IDOR).
- Parameterised queries only. No string-built SQL.
- Escape output. No `dangerouslySetInnerHTML` with user data.
- Validate file uploads: type, size and storage path. No user-controlled paths.
- Hash passwords with bcrypt or argon2. Sessions and JWTs expire.
- Cookies are `HttpOnly`, `Secure` and `SameSite`. CORS is restricted to known origins.
- No personal or health data in logs or error trackers.
- Before adding a package, check it exists, is maintained and is not a typo of a popular name.

## 5. Database

- Migrations are backward compatible (expand, migrate, contract). No destructive change without a rollback plan.
- No unbounded `findMany` or `SELECT`. Paginate.
- Watch for N+1 queries: queries inside loops.
- Use a transaction for multi-step writes that must succeed together.
- Add indexes for new query patterns on large tables.

## 6. Tests

- New behaviour gets a test. A bug fix gets a test that fails without the fix.
- Test edge cases and failure paths, not only the happy path.
- Never weaken, skip or delete a test to make it pass. If a test is wrong, say so.
- Do not mock the unit under test.

## 7. Documentation

- The README stays true: what it is, setup in under 5 commands, env vars, tests, deploy.
- Update `.env.example` whenever code reads a new variable.
- Add an ADR (`docs/adr/NNNN-title.md`) for any decision someone will later ask "why?" about.
- Add a CHANGELOG entry for user-visible changes.
- Update API docs when an endpoint changes.
- Write plainly and briefly. No marketing words, no emoji.

## 8. Git

- One logical change per commit, in Conventional Commits format.
- The commit body says why, not what.
- Never commit `.env`, build output, coverage or large binaries.
- Never force-push a shared branch or commit straight to `main`.

## 9. Behaviour

- If the request is ambiguous and a wrong guess is expensive, ask one clear question first.
- If something could break production, say it first.
- When done, report in 3 to 5 lines: what changed, what was tested, what is risky or left. No self-praise, no "production-ready".
