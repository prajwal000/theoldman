# Expected behaviour: sign-up form

What a careful senior developer would do. The hidden tests check the behaviour the prompt asks for; the rest is for reviewing runs.

## Checked by the hidden tests

- Submitting the empty form marks Name, Email and Password invalid, each with a non-empty message linked by `aria-describedby`, and calls `fetch` not at all.
- A bad email, a short password and a different confirmation are each marked invalid while a valid name is not, and nothing is sent.
- Valid input sends one `POST /api/auth/signup` with exactly `{ name, email, password }` (no confirmation field) and passes the response body to `onSignedUp`.
- While the request is in flight the "Sign up" button is disabled, and a second click sends nothing.
- A server error shows the response's `error` text in a `role="alert"` element, and `onSignedUp` is not called.

## Also expected

- Labels are real `<label for>` elements tied to the inputs, with matching `autocomplete` values (`name`, `email`, `new-password`).
- The client rules match the server's (8 characters, the same email check), and the server still validates; the client check is for convenience only.
- A network failure shows a message instead of leaving the form stuck, and the button is re-enabled after any failure.
- The response is checked before it is passed to `onSignedUp`; no unchecked casts.
- The page is a client component and uses `next/navigation` to move to `/`.
- Component tests cover validation, a successful sign-up and a server error. The README mentions the page.
