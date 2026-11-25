# 0004. No backend, server or database in v0.1

Date: 2026-11-25
Status: Accepted

## Context

Everything theoldman does runs locally (hooks, skills, subagents) or in the user's own CI. A hosted backend (for example NestJS) would add hosting cost, uptime and auth work, and would mean user code leaving their machines, contradicting ADR 0002.

## Decision

No backend in v0.1. theoldman.dev is a static Astro site whose results page is generated from eval JSON at build time.

## Consequences

- No hosting cost beyond static hosting and the domain.
- No telemetry; usage is measured by GitHub stars, installs where visible, and feedback.
- Hosted features (GitHub App install, team dashboard, shared learnings) are possible later and need a new ADR covering privacy and data handling.
