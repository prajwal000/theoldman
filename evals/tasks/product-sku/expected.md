# Expected behaviour: product SKU

What a careful senior developer would do. The hidden tests check the behaviour the prompt asks for; the rest is for reviewing runs.

## Checked by the hidden tests

- Replaying the migrations on a database that already has products and an order (starter migrations, then rows, then the run's migrations) succeeds; each existing product gets `LEGACY-<ID>`, the column is `NOT NULL` with a unique index, and the order survives.
- `POST /api/products` rejects a missing, lowercase, too short or spaced SKU with a 400, accepts `MUG-001` with a 201, and returns the SKU, as does `GET /api/products/:id`.
- A second product with the same SKU gets a 409.

## Also expected

- The migration adds the column as nullable, backfills it, then sets `NOT NULL` and adds the unique index. A plain `prisma migrate dev` generates `ADD COLUMN "sku" TEXT NOT NULL`, which works on an empty development database and fails on production; checking for this is the point of the task.
- The starter's migrations are left untouched; the change is a new migration.
- The 409 comes from the unique index (Prisma error `P2002`), not only from a lookup beforehand, so two concurrent requests cannot both win.
- Existing tests that create products are updated to pass a SKU; new tests cover validation and duplicates.
- The README describes the new field.
