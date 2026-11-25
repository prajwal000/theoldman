# 0001. TypeScript and Node for everything, including hook scripts

Date: 2026-11-25
Status: Accepted. Node version superseded by ADR 0005

## Context

theoldman's hook scripts run on users' machines on every edit. The first users are TypeScript developers. Claude Code runs on macOS, Linux and Windows.

## Decision

Write all code in strict TypeScript. Hook scripts run on Node 20+, bundled by esbuild into single `.mjs` files that are committed to `plugin/scripts/`.

## Consequences

- One language across plugin, evals, action and site.
- Works on Windows, unlike Bash scripts.
- Users need Node 20+; acceptable for the TypeScript audience. Documented in README.
- Bundles must be rebuilt and committed; `pnpm check` fails on stale bundles.
