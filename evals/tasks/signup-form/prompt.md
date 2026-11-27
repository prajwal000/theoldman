Add a sign-up page. Put the form in a `SignupForm` React component, the default export of `src/components/SignupForm.tsx`, and show it on a new `/signup` page.

- Fields, each with a visible label: "Name", "Email", "Password" and "Confirm password", and a "Sign up" button.
- Check the input before sending: a name is required, the email must look like an email address, the password needs at least 8 characters, and the confirmation must match it. Mark each invalid field with `aria-invalid="true"` and link it to its error message with `aria-describedby`. Send nothing while any field is invalid.
- Send `{ name, email, password }` to `POST /api/auth/signup` with `fetch`. Disable the button while the request is in flight, so the form can't be sent twice.
- If the server answers with an error, show its `error` message in an element with `role="alert"`.
- On success, call the component's `onSignedUp` prop with the response body. The page then sends the user to `/`.

The tests use Vitest; `@testing-library/react` and `jsdom` are installed for component tests.
