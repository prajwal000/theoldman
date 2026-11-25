# 0005. Target Node 22.13+

Date: 2026-11-25
Status: Accepted. Supersedes the Node version in ADR 0001

## Context

ADR 0001 set Node 20+ as the runtime for hook scripts and tooling. Node 20 reached end of life on 2026-04-30 and no longer gets security fixes. Current tooling also requires a newer Node: pnpm 11 needs Node 22.13+, and Vitest 5 needs Node 22+. Staying on Node 20 would mean pinning older pnpm and Vitest releases. Node 24 is the current LTS.

## Decision

theoldman targets Node 22.13+ for hook scripts, tooling and users.

- `.nvmrc` is `22`; `engines.node` is `>=22.13`.
- Hook bundles are built with esbuild target `node22`.
- CI runs on Node 22 and Node 24, on Linux, macOS and Windows.

## Consequences

- Users on Node 20 must upgrade before installing the plugin. Documented in README.
- Current pnpm and Vitest releases can be used without pins to old majors.
- Two Node versions in the CI matrix double its jobs.
- When Node 22 reaches end of life, a new ADR raises the minimum.
