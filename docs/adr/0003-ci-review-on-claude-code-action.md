# 0003. Build the CI reviewer on claude-code-action for v0.1

Date: 2026-11-25
Status: Accepted

## Context

theoldman needs PR review in CI. Writing a custom GitHub Action means owning GitHub API plumbing, auth and agent orchestration. AI review actions have been exploited through prompt injection in PR titles and comments and through `pull_request_target` workflows that check out fork code.

## Decision

v0.1 ships a workflow template using `anthropics/claude-code-action` with theoldman's reviewer and verifier prompts. theoldman owns the prompts, the rules and the hardening, not the plumbing.

Hardening is mandatory: `pull_request` trigger only, minimal permissions, no event text in shell or prompts, rules from the base branch, SHA-pinned actions, forks and drafts skipped. Verified with actionlint, zizmor and injection test PRs.

The template supports the Anthropic API and Amazon Bedrock. `id-token: write` is allowed only for the Bedrock OIDC option. The AWS role it assumes is scoped to Bedrock model invocation only (`bedrock:InvokeModel`, `bedrock:InvokeModelWithResponseStream`).

## Consequences

- Faster to ship; inherits upstream fixes.
- Depends on upstream behaviour and inputs; pin to a SHA and review on upgrade.
- A custom action can replace it later via a new ADR if the template is too limiting.
