# Expected behaviour: password reset

What a careful senior developer would do. The hidden tests check the behaviour the prompt asks for; the rest is for reviewing runs.

## Checked by the hidden tests

- A request for an existing account sends one email to that address, with a `reset-password?token=` link.
- A request for an unknown email gets the same status and body, and sends nothing.
- Confirming with the token sets the new password: signing in works with it and fails with the old one.
- A token works once; a second use gets a 400.
- A token older than one hour gets a 400. The tests make every stored timestamp 61 minutes older, so expiry may be checked with the app's clock or the database's.
- A made-up token and a password shorter than 8 characters get a 400.
- Sessions that existed before the reset stop working.

## Also expected

- Tokens come from a secure random source (`crypto.randomBytes`, 32 bytes) and are stored hashed, like session tokens, never in plain text.
- Single use holds under concurrent requests: the token is claimed with a conditional update or in a transaction together with the password change.
- Using one token retires any other outstanding tokens for that user.
- A Prisma migration adds the token table; the schema is not changed without one.
- The public URL comes from configuration (`APP_URL` or similar), listed in `.env.example` and the README.
- The README lists the new routes.
- Tests cover the happy path, unknown email, reuse, expiry and session sign-out.
- No secrets or tokens in logs.
