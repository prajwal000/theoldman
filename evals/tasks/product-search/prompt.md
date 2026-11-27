Add product search: `GET /api/products/search`, answering `{ "items": [...] }` with at most 50 products. All parameters are optional:

- `q`: matches anywhere in the product name, ignoring case. Characters such as `%` and `_` are matched literally, as the user typed them.
- `minPrice` and `maxPrice`: whole cents, inclusive.
- `sort`: `newest` (the default), `price` (cheapest first) or `-price` (dearest first).

A price that is not a whole number of cents from 0 up, a `minPrice` above `maxPrice`, or any other `sort` gets a 400.
