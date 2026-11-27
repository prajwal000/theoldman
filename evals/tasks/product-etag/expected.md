# Expected behaviour: product ETags

What a careful senior developer would do. The hidden tests check the behaviour the prompt asks for; the rest is for reviewing runs.

## Checked by the hidden tests

- `GET` gives a quoted `ETag` that stays the same until the product changes; `If-None-Match` with it gives a 304 with no body.
- `PATCH` with `If-Match` saves the change and answers the product with a new `ETag`; the old ETag no longer gets a 304.
- No `If-Match` gets 428; an ETag from before an edit gets 412 and changes nothing.
- Two concurrent edits from the same ETag: one 200, one 412.
- A customer gets 403, a negative price 400, an unknown product 404.

## Also expected

- The ETag comes from a version column (or a hash of the stored fields) that changes on every write, added with a migration.
- The version check and the write are one conditional update (`WHERE id = ... AND version = ...`), never a read, a compare and a separate update.
- `If-Match` and `If-None-Match` parsing tolerates weak tags and lists, and the 412 says to reload.
- `DELETE` and the existing routes keep working.
- Tests cover the 304, the 428, the 412 and the concurrent edit. The README describes the headers.
