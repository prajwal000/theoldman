# Expected behaviour: product pagination

What a careful senior developer would do. The hidden tests check the behaviour the prompt asks for; the rest is for reviewing runs.

## Checked by the hidden tests

- No `limit` gives 20 items, newest first, and a `nextCursor` when more follow.
- Paging with `limit` and `cursor` returns every product exactly once, in newest-first order, including products that share a `createdAt`.
- The last page has `nextCursor: null`, including when it is exactly full, and an empty catalogue gives `{ items: [], nextCursor: null }`.
- A `limit` above 100 returns 100 items.
- `limit` values `0`, `-3`, `abc` and `2.5` get a 400.

## Also expected

- A stable order with a unique tie-breaker (`createdAt`, then `id`), and a cursor that encodes that position, so ties are neither skipped nor repeated.
- One extra row fetched (`take: limit + 1`) to know whether another page follows, rather than a count query or an empty last page.
- An index that matches the order (`@@index([createdAt, id])`), added with a migration.
- A malformed cursor gets a 400, not a 500.
- The README describes the new query parameters and response shape, which changes for existing clients.
- The starter's own test for the list is updated to the new shape, and tests cover ties, the cap and bad input.
