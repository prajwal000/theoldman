# Build tasks

The build-mode eval tasks. Each one asks for a change to the shared starter app (`evals/starters/next-prisma/`, a small shop API on Next.js, Prisma and Postgres), and each tests something different. Every task has `prompt.md`, hidden tests, `expected.md` (what the tests check and what a careful developer would also do) and a `reference.patch` that passes the hidden tests. See `_template/README.md` for how a task is put together.

| Task                   | Asks for                                       | Tests                                                    |
| ---------------------- | ---------------------------------------------- | -------------------------------------------------------- |
| `password-reset`       | Emailed single-use reset tokens that expire    | Token handling, account enumeration, session sign-out    |
| `product-pagination`   | Cursor pagination for the product list         | Stable ordering with ties, limits, input validation      |
| `payment-webhook`      | A Stripe-style signed payment webhook          | Signature checks on the raw body, replay, idempotency    |
| `product-soft-delete`  | Soft delete for products                       | Keeping history, filtering every read path, migrations   |
| `avatar-upload`        | Profile picture upload                         | File type sniffing, size limits, path traversal          |
| `session-lifetime-env` | A `SESSION_TTL_DAYS` environment variable      | Config validation, failing loudly, docs for env vars     |
| `product-sku`          | A required, unique column on a table with data | Migrations that backfill existing rows                   |
| `signup-form`          | A React sign-up form with validation           | Accessible validation, double submit, server errors      |
| `order-email-job`      | Order emails from a Postgres background job    | Claiming jobs once under concurrency, retries            |
| `order-access-bugfix`  | Fix customers seeing other customers' orders   | Fixing an IDOR everywhere it occurs, keeping the test    |
| `login-rate-limit`     | A limit on failed sign-ins                     | Brute-force protection stored across servers             |
| `stock-levels`         | Stock that never oversells                     | Atomic conditional updates under concurrent orders       |
| `admin-user-roles`     | Admin role management that keeps one admin     | Authorisation and an invariant across rows under a race  |
| `profile-update`       | Profile editing                                | Mass assignment, re-authentication for an email change   |
| `product-search`       | Search with filters and sorting                | LIKE wildcards, sort allow-lists, injection-shaped input |
| `orders-csv-export`    | Order history as CSV                           | RFC 4180 quoting, spreadsheet formula injection          |
| `product-etag`         | Product edits with ETags                       | HTTP caching and optimistic concurrency                  |
| `admin-audit-log`      | An audit log of admin actions                  | Writing the log in the same transaction as the action    |
| `daily-sales-timezone` | Daily sales in a chosen time zone              | Day boundaries across time zones and daylight saving     |
| `account-deletion`     | GDPR account deletion                          | Anonymising personal data while keeping orders           |

`_template` is not a task: it is the example to copy, with a starter of its own.

Run a task with the runner and score the runs:

```text
pnpm --filter evals run eval --task <id> --condition with --runs 3
pnpm --filter evals run eval --task <id> --condition without --runs 3
pnpm --filter evals run score -- <run folder> <run folder>
```
