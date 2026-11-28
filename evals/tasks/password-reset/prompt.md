Users who forget their password are stuck. Add a password reset flow to the API:

- `POST /api/auth/password-reset/request` with `{ "email" }` emails the user a link to `/reset-password?token=<token>` on the app's public URL, set in the `APP_URL` environment variable. It must answer the same way, with a 200, whether or not the email has an account, so nobody can use it to find out who has one.
- `POST /api/auth/password-reset/confirm` with `{ "token", "password" }` sets the new password and answers 200. A token works once and expires after one hour. The new password follows the same rules as at signup. An invalid, used or expired token, or a password that breaks the rules, gets a 400.
- After a reset, the user's existing sessions must stop working.

Send the email with `sendEmail` from `src/lib/email.ts`.
