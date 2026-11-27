# Expected behaviour: stock levels

What a careful senior developer would do. The hidden tests check the behaviour the prompt asks for; the rest is for reviewing runs.

## Checked by the hidden tests

- `POST /api/products` stores `stock` (5), defaults it to 0, and rejects `-1`, `1.5` and `"3"` with a 400; `GET /api/products/:id` returns it.
- Ordering 2 of 5 leaves 3; ordering 4 more gets a 409, creates no order and leaves 3.
- Ten concurrent orders of 1 against a stock of 3: exactly three get 201, the rest 409, stock ends at 0 with three orders.
- Two concurrent orders of 3 against a stock of 5: one succeeds, one gets a 409, stock ends at 2.

## Also expected

- The stock is taken with one conditional update (`UPDATE ... SET stock = stock - n WHERE id = ... AND stock >= n`, or Prisma `updateMany` with `stock: { gte: n }`), not read, checked and written in separate steps.
- The stock change and the order are one transaction, so a failed order never loses stock.
- A database check constraint (`stock >= 0`) backs the rule, added in the migration, which adds the column with a default so existing rows get 0.
- An unknown product is still a 404, distinct from the 409 for too little stock.
- Tests cover the concurrent case, not only sequential orders. The README describes `stock` and the 409.
