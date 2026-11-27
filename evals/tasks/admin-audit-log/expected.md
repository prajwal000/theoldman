# Expected behaviour: admin audit log

What a careful senior developer would do. The hidden tests check the behaviour the prompt asks for; the rest is for reviewing runs.

## Checked by the hidden tests

- Creating a product records `{ actorId, action: "product.create", targetId, createdAt }` with a valid timestamp.
- Deleting it records `product.delete`; deleting it again gets a 404 and records nothing, and both entries remain.
- A customer's refused create (403) and an admin's invalid create (400) record nothing.
- After 102 creates, the log returns 100 entries, newest first.
- The log answers 401 signed out and 403 to a customer.

## Also expected

- The entry is written in the same transaction as the action, so a crash between the two cannot leave an action without an entry or an entry without an action.
- Entries do not use relations that cascade on delete, so removing a product or user does not erase its history.
- Recording is one shared helper with a fixed set of action names, not ad hoc writes in each route.
- No personal data beyond the actor's id is copied into entries.
- A migration adds the table, with an index for the newest-first read.
- Tests cover the recorded entries, the refused actions and the access rules. The README lists the route.
