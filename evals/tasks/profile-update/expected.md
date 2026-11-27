# Expected behaviour: profile update

What a careful senior developer would do. The hidden tests check the behaviour the prompt asks for; the rest is for reviewing runs.

## Checked by the hidden tests

- A new name is saved trimmed, answered as `{ user }` and shown by `GET /api/users/me`.
- A body that also sets `role`, `passwordHash` and `id` leaves all three alone: the user stays a customer, keeps their id and can still sign in with their password.
- A new email without `currentPassword`, or with a wrong one, gets a 403 and changes nothing; with the right one it is saved lowercased, and signing in works with the new email and fails with the old.
- An email used by another account gets a 409.
- An empty name and an invalid email get 400; a signed-out request gets 401.

## Also expected

- The update copies allowed fields one by one; the request body is never spread into `data`.
- The 409 comes from the unique index (Prisma `P2002`), so two users cannot race to the same email.
- The password is checked with the existing `verifyPassword`, and only when the email actually changes.
- Validation reuses the signup rules rather than a second, different copy.
- Tests cover mass assignment, the password requirement and the duplicate email. The README lists the route.
