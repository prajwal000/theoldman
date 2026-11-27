# Expected behaviour: product search

What a careful senior developer would do. The hidden tests check the behaviour the prompt asks for; the rest is for reviewing runs.

## Checked by the hidden tests

- `q=mug` finds `Blue MUG` and `Mugwort tea` but not `Teapot`, newest first.
- `q=100%` finds only `100% cotton tee`, not `100 cotton tee`; `q=a_b` finds only `a_b`, not `axb`.
- `minPrice` and `maxPrice` include both ends; `sort=price`, `sort=-price` and the default `newest` order the results.
- `minPrice=abc`, `maxPrice=-1`, `minPrice=1.5`, `minPrice` above `maxPrice`, `sort=name` and `sort=__proto__` each get a 400.
- 60 matching products give 50 items.
- SQL-shaped input (`'; DROP TABLE "Product"; --`, `' OR '1'='1`) finds nothing and harms nothing.

## Also expected

- The query is built with Prisma or parameterised SQL; the search text is never concatenated into SQL.
- `LIKE` wildcards are handled on purpose. Prisma 7's `contains` passes `%` and `_` through to Postgres as wildcards (checked with the reference solution), so they, and the backslash, must be escaped first. With raw SQL, the same escaping goes with an `ESCAPE` clause.
- `sort` is looked up in a fixed allow-list (with an own-property check), never passed through as a column name.
- Results have a stable order with a tie-breaker, and a result limit.
- A trigram or functional index for case-insensitive search is mentioned or added if the table is expected to be large.
- Tests cover the literal wildcards, the filters, the sorts and the 400s. The README lists the route.
