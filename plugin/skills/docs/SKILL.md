---
name: docs
description: Audit the project's documentation (README, .env.example, ADRs, CHANGELOG) against the code and propose fixes. Use when the user asks to check or update the docs, or runs /theoldman:docs.
---

# Audit the docs

Check each item against the code with Read, Grep and Glob. Do not run commands and do not change files in this step.

1. **README**: every setup step and command it lists still works. Check commands against the `scripts` in `package.json` and the files they name. Setup takes at most 5 commands. Env vars, tests and deploy are covered.
2. **.env.example**: every variable the code reads (`process.env.X`, `process.env['X']`, `import.meta.env.X`) is listed, with a placeholder value and no real secret. Variables no longer read are flagged.
3. **ADRs** (`docs/adr/`): every dependency in `package.json` that a reader would ask "why?" about, and every major decision visible in the code, such as a datastore, an auth approach or a framework, has an ADR. Numbering has no gaps or duplicates.
4. **CHANGELOG**: user-visible changes since the last release are listed under `Unreleased`, in Keep a Changelog format.

Report what is missing or wrong as a short list, one line per problem, with the file and what to change. If everything is in order, say so.

Then ask whether to apply the fixes. If the user agrees, run the `theoldman:oldman-docs-writer` subagent with the list of problems. It can only change documentation files.
