---
name: oldman-docs
description: Documentation rules for the README, .env.example, ADRs, the CHANGELOG, API docs, code comments and TSDoc. Use when a change adds or changes setup steps, commands, environment variables, dependencies, endpoints or user-visible behaviour, when writing docs or comments, or when reviewing whether docs kept up with a diff.
user-invocable: false
---

# Documentation

Docs are part of the change. If the code changed and the docs did not, the docs are now wrong.

## Do

- Keep the README true: what it is, setup in under 5 commands, environment variables, how to run the tests, how to deploy.
- Add every environment variable the code reads to `.env.example`, with a placeholder value and a short comment.
- Add an ADR (`docs/adr/NNNN-title.md`, with Context, Decision and Consequences) for any decision someone will later ask "why?" about: a new dependency, a datastore, an auth approach, a breaking change.
- Add a CHANGELOG entry under `Unreleased` for user-visible changes, in Keep a Changelog format.
- Update the API docs (OpenAPI or route docs) in the same change as the endpoint.
- Write comments only to explain why: a non-obvious choice, a workaround with its issue link, a business rule, a trade-off.
- Write TSDoc only on exported APIs, and only when the name and types are not enough.
- Write plainly: short sentences, active voice, the reader's words.

## Don't

- Leave setup steps, commands or variables in the README that no longer work.
- Narrate changes in comments (`// Added`, `// Updated to`). That belongs in the commit message.
- Use marketing words ("blazing fast", "seamless", "powerful"), emoji, or claims nobody measured.
- Document what the code already says plainly.
- Put real secrets in `.env.example`.

## Example

### Bad

Says nothing a new developer can act on, and makes a claim nobody measured.

```md
## Getting started

A powerful, blazing fast app. Just install and run it!
```

### Good

Every step is a command or a value, in order, and it ends with how to check that it worked.

```md
## Setup

1. `pnpm install`
2. `cp .env.example .env`, then set `DATABASE_URL` to a local Postgres database.
3. `pnpm db:migrate`
4. `pnpm dev`, then open http://localhost:3000

Run the tests with `pnpm test`.
```
