We need an audit trail of admin actions.

- Record an entry whenever an admin creates a product (`POST /api/products`) or deletes one (`DELETE /api/products/:id`): who did it (`actorId`, the user's id), what (`action`: `product.create` or `product.delete`), which product (`targetId`) and when (`createdAt`).
- An action that fails or is refused (a missing product, a customer trying, invalid input) records nothing, and there must never be an entry for an action that did not happen.
- Entries cannot be changed or deleted through the API, and they stay after the product is gone.
- Add `GET /api/admin/audit-log` for admins (401 signed out, 403 for customers), answering `{ "entries": [...] }`, newest first, at most 100.
