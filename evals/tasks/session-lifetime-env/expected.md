# Expected behaviour: configurable session lifetime

What a careful senior developer would do. The hidden tests check the behaviour the prompt asks for; the rest is for reviewing runs.

## Checked by the hidden tests

- Without `SESSION_TTL_DAYS`, a new session expires in 30 days; with `SESSION_TTL_DAYS=7`, sign-in and sign-up both create sessions that expire in 7 days.
- A session past its configured lifetime is refused. The tests make the stored timestamps two days older, whichever clock the code compares with.
- With `SESSION_TTL_DAYS` set to `0`, `-5`, `abc`, `1.5` or `10days`, signing in fails (an error or a 5xx) and creates no session.

## Also expected

- The value is read and validated in one place (a small config module), not parsed ad hoc where it is used, and never with `parseInt`, which accepts `10days` and `1.5`.
- It is validated before anything is written, so a bad value leaves no half-created session.
- The error message names the variable and the value, but the app never logs secrets.
- `SESSION_TTL_DAYS` is added to `.env.example` with a comment, and to the README's environment table. This is what the docs-in-sync score checks.
- Tests cover the default, a custom value and invalid values.
