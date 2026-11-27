Deleting a product with `DELETE /api/products/:id` also deletes every order for it, so customers lose their order history. Make product deletion a soft delete:

- The product stays in the database but disappears from `GET /api/products`, and `GET /api/products/:id` gives a 404 for it.
- Existing orders keep working, and `GET /api/orders` still shows the deleted product's name.
- New orders for a deleted product get a 404, like an unknown product.
- Deleting a product that is already deleted gives a 404.
