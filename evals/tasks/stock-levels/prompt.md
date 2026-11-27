Products need stock levels.

- Add a `stock` count to products. Existing products start at 0. Admins can set it when they create a product (`stock` in `POST /api/products`, default 0); anything but a whole number from 0 up gets a 400. Products are returned with their stock.
- Placing an order takes its quantity out of stock. An order for more than is in stock gets a 409 and changes nothing.
- During sales many customers order at the same moment, so stock must never go below zero and we must never accept more orders than we have stock for, however many requests arrive at once.
