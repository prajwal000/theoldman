A customer reported that they can see other customers' orders: changing the order id in the URL of `GET /api/orders/:id` shows someone else's order. `test/orders.test.ts` has a failing test that shows it.

Fix the bug, and make sure no other order route has the same problem. Someone else's order must look exactly like an order that does not exist (a 404), so nobody can probe for order ids.
