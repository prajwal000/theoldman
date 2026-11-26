---
name: oldman-git
description: Git rules for commits, commit messages, branches, pull requests, merges, rebases and pushes. Use when committing, writing a commit or pull request message, creating or updating a branch, resolving conflicts, or pushing.
user-invocable: false
---

# Git

History is documentation. Each commit should make sense on its own a year from now, to someone who was not there.

## Do

- Make one logical change per commit. Split unrelated changes into separate commits.
- Write titles in Conventional Commits format: `type(scope): summary`, with a type such as `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `ci` or `build`. Keep the title under 72 characters, in the imperative.
- Use the body to say why the change was made and what it affects. The diff already shows what changed.
- Work on a branch and open a pull request small enough to review.
- Check `git status` and the staged diff before each commit.
- Resolve conflicts by reading both sides and keeping what each side meant, then run the tests.

## Don't

- Force-push or delete `main`, `master` or any shared branch. theoldman blocks this (OLDMAN-G01).
- Skip hooks with `--no-verify`. theoldman blocks this (OLDMAN-G02). Fix what the hook reports instead.
- Commit `.env` files, keys, build output, coverage, `node_modules` or large binaries.
- Commit straight to `main`.
- Mix a refactor, a feature and formatting changes in one commit.
- Write titles like `fix stuff`, `wip` or `update files`.
- Amend or rebase commits that others have already pulled.

## Example

### Bad

Says nothing about what changed or why, and hides a bug fix inside a formatting commit.

```text
update files
```

### Good

The title names the change; the body gives the reason and the effect.

```text
fix(auth): expire sessions after 24 hours without activity

Sessions never expired, so a stolen cookie worked forever. Expiry is
now checked on each request and pushed back on activity.
```
