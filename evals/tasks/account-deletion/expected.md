# Expected behaviour: account deletion

What a careful senior developer would do. The hidden tests check the behaviour the prompt asks for; the rest is for reviewing runs.

## Checked by the hidden tests

- No password or a wrong one gets a 403 and leaves the account working; signed out gets 401.
- After a 204, the old session gets 401, signing in with the old email and password gets 401, and no user row has the old email or name.
- The user's order still exists with its total, and whatever it links to has neither the old email nor the old name.
- The same email can sign up again (201).

## Also expected

- Either the user row is anonymised in place (email replaced with a unique, undeliverable value such as `deleted-<id>@deleted.invalid`, name cleared, password hash made unusable) or orders are detached with a nullable relation (`onDelete: SetNull`). It must not be a hard delete that cascades away the orders, as the starter's relation would.
- Sessions, reset tokens and anything else holding personal data are removed in the same transaction.
- The password is checked again even though the user has a session.
- No personal data of the deleted user is written to logs.
- A migration records the change (a `deletedAt` column or the relation change).
- Tests cover the password check, the anonymisation, the kept orders and signing up again. The README lists the route.
