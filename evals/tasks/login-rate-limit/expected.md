# Expected behaviour: login rate limit

What a careful senior developer would do. The hidden tests check the behaviour the prompt asks for; the rest is for reviewing runs.

## Checked by the hidden tests

- Five wrong passwords get 401; the sixth attempt gets 429 with a `Retry-After` of 1 to 900 seconds, and so does the right password.
- Once 15 minutes have passed (the tests move the clock with fake `Date`), the right password works again.
- After four failures, a successful sign-in resets the count: four more failures still get 401.
- Failures under `Ada@Example.com` count for `ada@example.com`; an unknown email is locked after five guesses too.
- One email being locked does not affect another account.

## Also expected

- The lock is checked before the password, so a locked account says nothing about whether a guess was right.
- Failures are stored per normalised email in a table with an index on (email, time), added with a migration; old rows are cleared on success and can be pruned.
- The window is measured with the app's clock and the stored timestamps, not a counter that never expires.
- `Retry-After` is a whole number of seconds that matches the real wait.
- Unknown emails cost the same as known ones, so the limit cannot be used to find accounts.
- Tests cover locking, unlocking after the window, resetting on success and case handling. The README mentions the limit.
