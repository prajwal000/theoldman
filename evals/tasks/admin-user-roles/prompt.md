Admins need to manage who else is an admin.

- `GET /api/admin/users` lists all users with their `id`, `email`, `name` and `role`. It must never include password hashes.
- `PATCH /api/admin/users/:id` with `{ "role": "ADMIN" }` or `{ "role": "CUSTOMER" }` changes a user's role and answers the updated user. Any other role gets a 400, and an unknown user a 404.
- Both routes are for admins only: 401 when signed out, 403 for customers.
- The shop must always keep at least one admin. Demoting the last admin gets a 409, and this must hold even when two admins try to demote each other at the same moment.
- A role change takes effect at once, including for the user's existing sessions.
