---
name: oldman-database
description: Database rules for schema changes, migrations, queries, ORMs such as Prisma or Drizzle, raw SQL, transactions, indexes and seed data. Use when writing or reviewing a migration, a schema change, a query or a repository function, or when a page or endpoint reads lists of rows.
user-invocable: false
---

# Database

Data outlives code. A bad query is slow; a bad migration loses data. Plan every change so the running app keeps working while it is deployed.

## Do

- Make migrations backward compatible: expand (add a nullable column or a new table), migrate the data, then contract in a later release.
- Give every destructive change (drop, rename, type change) a rollback plan, and say it in your summary.
- Paginate every list query with a limit and a cursor or offset, and cap the page size.
- Load related rows in one query (`include`, a join, or `IN (...)`) instead of one query per row.
- Wrap multi-step writes that must succeed together in a transaction.
- Add an index for each new query pattern on a large table. Check the query plan when unsure.
- Use parameterised queries. With raw SQL in Prisma, use the `$queryRaw` tagged template, not `$queryRawUnsafe`.
- Scope every query to the tenant in multi-tenant apps.
- Store money as integer minor units or a decimal type.

## Don't

- Run `prisma migrate reset`, `prisma db push --force-reset`, `DROP` or `TRUNCATE` against a database that is not local. theoldman blocks these (OLDMAN-G04).
- Edit a migration that has already run anywhere. Add a new one.
- Rename or drop a column in the same release as the code that stops using it.
- Call `findMany()` or `SELECT *` without a limit on a table that grows.
- Run a query inside a loop.
- Store money as a floating-point number.
- Put real personal data in seeds or fixtures.

## Example

### Bad

Loads every order, then runs one more query per order (N+1).

```ts
const orders = await prisma.order.findMany();
for (const order of orders) {
  order.customer = await prisma.customer.findUnique({ where: { id: order.customerId } });
}
```

### Good

One query, scoped to the tenant, a page at a time, with the customer loaded by a join.

```ts
const PAGE_SIZE = 50;

const orders = await prisma.order.findMany({
  where: { tenantId },
  include: { customer: true },
  orderBy: { id: 'desc' },
  take: PAGE_SIZE,
  ...(cursor === undefined ? {} : { skip: 1, cursor: { id: cursor } }),
});
```
