---
name: oldman-security
description: Security rules for code that handles authentication, sessions, passwords, permissions, user input, file uploads, cookies, CORS, secrets or personal data. Use when writing or reviewing routes, login and signup flows, access checks, input handling, uploads or logging, and before adding a package.
user-invocable: false
---

# Security

Assume every request comes from someone trying to read or change data that is not theirs. Fix the hole before adding the feature.

## Do

- Check authentication on every route, then check that the signed-in user owns or may access the resource (no IDOR). In multi-tenant apps, scope every query to the tenant.
- Validate all external input at the boundary with a schema (Zod or equivalent): body, params, query, headers and webhook payloads.
- Use parameterised queries or the ORM's query builder for every query.
- Escape output. Let the framework render user text as text.
- Validate uploads: allowed types, a size limit, and a storage path you generate. Never use a path or file name from the user as is.
- Hash passwords with bcrypt or argon2. Give sessions and JWTs an expiry, and issue a new session on login.
- Set cookies `HttpOnly`, `Secure` and `SameSite`. Restrict CORS to known origins.
- Read secrets from the environment and list each name, never the value, in `.env.example`.
- Before adding a package, check that it exists, is maintained, and is not a typo of a popular name.

## Don't

- Build SQL, shell commands or file paths by joining strings with user input.
- Use `dangerouslySetInnerHTML`, `innerHTML` or `eval` with user data.
- Log passwords, tokens, keys, or personal or health data, or send them to an error tracker.
- Commit secrets, `.env` files or private keys, even in tests or fixtures. theoldman blocks these writes (OLDMAN-G05, OLDMAN-G06, OLDMAN-S01).
- Trust IDs, roles, prices or flags sent by the client.
- Return stack traces or internal error messages to the client.
- Turn off TLS verification, CSRF protection or an auth check "for now".

## Example

### Bad

Any signed-in user can read any invoice, and the ID is pasted into the SQL text.

```ts
app.get('/invoices/:id', requireUser, async (req, res) => {
  const rows = await db.query(`SELECT * FROM invoices WHERE id = ${req.params.id}`);
  res.json(rows[0]);
});
```

### Good

The ID is validated, passed as a parameter, and the invoice must belong to the user. A missing and a forbidden invoice look the same to the caller.

```ts
const InvoiceParams = z.object({ id: z.string().uuid() });

app.get('/invoices/:id', requireUser, async (req, res) => {
  const { id } = InvoiceParams.parse(req.params);
  const invoice = await db.invoice.findFirst({ where: { id, ownerId: req.user.id } });
  if (invoice === null) return res.status(404).end();
  res.json(invoice);
});
```
