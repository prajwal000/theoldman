`GET /api/products` returns every product in one response, and the catalogue keeps growing. Add cursor pagination to it:

- `?limit=` sets the page size: 20 by default, at most 100 (a larger value is capped at 100). A limit that is not a positive whole number gets a 400.
- The response becomes `{ "items": [...], "nextCursor": "..." }`. Passing `nextCursor` back as `?cursor=` gives the next page. `nextCursor` is null on the last page.
- Keep the newest-first order. Paging through to the end must return every product exactly once, even when several products were created at the same moment.
