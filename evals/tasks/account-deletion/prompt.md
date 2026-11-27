Users must be able to delete their account (GDPR). Add `DELETE /api/users/me`:

- It needs the user's password in the body as `{ "password" }`: 403 if it is missing or wrong, 401 when signed out.
- It removes the user's personal data (name, email and password) and signs them out everywhere. Answer 204.
- Keep their orders, because accounting needs them, but no longer linked to anything that identifies the person.
- Afterwards the same email can be used to sign up again.
