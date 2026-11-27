# Expected behaviour: admin user roles

What a careful senior developer would do. The hidden tests check the behaviour the prompt asks for; the rest is for reviewing runs.

## Checked by the hidden tests

- An admin promotes a customer (200, role `ADMIN`), and that customer's existing session can then add a product.
- An admin can demote another admin; demoting the last admin gets a 409.
- Two admins demoting each other at the same moment leave exactly one admin.
- Signed out gets 401, a customer 403, an unknown role 400 and an unknown user 404.
- The user list contains the users' emails and no password hash (no `passwordHash` key, no bcrypt `$2` hash); a customer gets 403.

## Also expected

- The last-admin rule is enforced inside a transaction that locks the admin rows (`SELECT ... FOR UPDATE`), or with serializable isolation and a retry, not with a count read before a separate update.
- The admin check is one shared helper used by both routes, not copied.
- Responses select fields explicitly instead of returning the user row and deleting the hash afterwards.
- No migration is needed; the schema already has roles.
- Tests cover the last-admin rule, including the concurrent case, and the authorisation answers. The README lists the routes.
