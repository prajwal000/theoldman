# Expected behaviour: product soft delete

What a careful senior developer would do. The hidden tests check the behaviour the prompt asks for; the rest is for reviewing runs.

## Checked by the hidden tests

- After an admin deletes a product, its row is still in the `Product` table, it is missing from the list, fetching it gives a 404, and deleting it again gives a 404.
- A customer's order for the product survives the delete and still shows the product's name; a new order for it gets a 404.

## Also expected

- A nullable `deletedAt` timestamp (or similar), added with a migration that only adds a column, so it is backward compatible.
- Every read path that should hide deleted products filters them: the list, the single product and ordering. The order history deliberately does not.
- The relation from orders to products no longer cascades deletes (`onDelete: Restrict` or similar), so a later hard delete cannot wipe order history again.
- The delete marks the row with a conditional update, so a second delete is a clean 404.
- The README says what delete now does.
- Tests cover the kept orders, the hidden product and refused new orders.
