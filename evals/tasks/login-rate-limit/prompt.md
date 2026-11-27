Stop password guessing on `POST /api/auth/login`.

- After 5 failed sign-ins for the same email within 15 minutes, answer 429 with a `Retry-After` header (in seconds), even when the password is right, until the oldest of those failures is 15 minutes old.
- A successful sign-in clears the failures for that email.
- Emails are compared case-insensitively, and unknown emails are limited the same way as real ones.
- We run several app servers, so count failures in the database, not in memory.
