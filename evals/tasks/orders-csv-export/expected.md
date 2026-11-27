# Expected behaviour: order CSV export

What a careful senior developer would do. The hidden tests check the behaviour the prompt asks for; the rest is for reviewing runs.

## Checked by the hidden tests

- Signed out gets 401; the answer is `text/csv` with `attachment` and `orders.csv` in `Content-Disposition`.
- The header row is exactly `order_id,date,product,quantity,total,status`; only the customer's own orders follow, newest first, with ISO 8601 UTC dates, quantity, status and totals such as `24.10`, `0.05` and `1000.00`.
- A product name with a comma, quotes and a line break reads back unchanged with an RFC 4180 parser.
- Names starting with `=`, `+`, `-` and `@` do not start with those characters once parsed, and still contain the original text.

## Also expected

- Formula injection is handled as OWASP describes: a leading apostrophe (or similar) before `=`, `+`, `-`, `@`, tab and carriage return in text fields, applied to every text column, not only the product name.
- Money is formatted from integer cents with integer arithmetic, not `(cents / 100).toFixed(2)` on large values or float sums.
- CSV writing is a small tested helper rather than string concatenation inside the route; no new dependency is needed for it.
- The response is marked private and not cacheable, since it holds personal data.
- Tests cover quoting and formula guarding. The README lists the route.
