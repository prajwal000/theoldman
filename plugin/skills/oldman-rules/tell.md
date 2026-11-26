# Rule lines for the Tell hooks

The theoldman hooks give Claude the bullet lines under these headings: `core` at the start of every session. Keep each line short and in line with `SKILL.md` in this folder, which has the full rules. Text outside the bullet lists, like this paragraph, is not sent.

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
