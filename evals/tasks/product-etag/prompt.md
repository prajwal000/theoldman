Admins edit products in several browser tabs and overwrite each other's changes. Add product editing with optimistic concurrency:

- `GET /api/products/:id` returns an `ETag` header for the product's current version, and answers 304 (no body) to an `If-None-Match` with that ETag.
- `PATCH /api/products/:id` (admins only: 401 signed out, 403 for customers) changes `name` and/or `priceCents`, with the same rules as creating a product (400 otherwise). It needs an `If-Match` header with the ETag the admin last read: 428 when it is missing, 412 when the product has changed since. It answers the updated product with its new `ETag`. Unknown products get a 404.
- When two admins send an edit based on the same version at the same moment, exactly one must win.
