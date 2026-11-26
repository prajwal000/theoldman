# 0007. Keep the custom eval runner; use the Anthropic API for full runs

Date: 2026-11-27
Status: Accepted

## Context

The evals run Claude Code on coding tasks with and without theoldman, then score each run: hidden tests, tsc and ESLint errors, Semgrep and gitleaks findings, filler comments, tests added, docs in sync, tokens and time. The plan was a custom TypeScript runner that starts each run in Docker. Claude Code 2.1.332 has a built-in `claude plugin eval` that runs cases with and without a plugin and reports the score difference. Before building our own runner we checked whether the built-in one could replace it, or drive the runs while our scorers score them.

The spike (2026-11-26, Windows 11, Claude Code 2.1.332, Docker 29.6.2) ran two small cases, a `slugify` utility and a token-bucket rate limiter, one run per arm with `--ablation with-without`. The agent and the LLM judge both used `claude-sonnet-5-5`. The runs used a claude.ai login and only the Write and Edit tools. Hidden tests were run afterwards against the kept workspaces.

| Case         | Arm     | Score | Turns | Time | Cost   | Output tokens | Subagents           | Hidden tests |
| ------------ | ------- | ----- | ----- | ---- | ------ | ------------- | ------------------- | ------------ |
| rate-limiter | with    | 1.00  | 11    | 65 s | $0.226 | 9,018         | reviewer, verifier  | 4/4          |
| rate-limiter | without | 1.00  | 3     | 18 s | $0.091 | 3,090         | none                | 4/4          |
| slugify      | with    | 1.00  | 9     | 25 s | $0.080 | 2,534         | none (light review) | 5/5          |
| slugify      | without | 1.00  | 3     | 8 s  | $0.062 | 1,065         | none                | 5/5          |

The whole suite took 71 s and cost $0.479, including $0.020 for judge calls. The score difference was 0 in both cases. These cases tested the harness, not theoldman. The time, cost and token columns come from each run's trace, not from the result file.

What we found, question by question:

- **Bedrock.** Checked from the docs and the CLI flags only, not run live. The docs say each run inherits the provider variables of the shell that starts the suite. The run trace records the provider per model (`"provider": "firstParty"` here). The result file does not.
- **Tokens, including subagents.** The result file has cost, turns and duration per run, but no tokens and no model IDs. The tokens are only in the run's trace. Each trace is the child's stream-json output, and its last event carries `modelUsage` and `subagent_stats`. `modelUsage` includes the subagents: 9,018 output tokens against 7,032 in `usage` for the rate-limiter run with theoldman. Traces are kept only with `--keep-temp` or when a run fails.
- **Docker, or its own sandbox.** Each run is a `claude -p` child with its own home and workspace, in `dontAsk` mode, with every tool not granted removed. Granting Bash requires an OS sandbox. On native Windows the run is refused before it starts ("sandbox required but unavailable"). In a Debian container, bubblewrap cannot create namespaces under Docker's default seccomp profile, but works with `--security-opt seccomp=unconfined`. Inside a container with the default profile, plugin eval accepted a Bash grant and started the run. The run then stopped at "Not logged in", because no credentials were passed in, so a full run in Docker is untested. Its sandbox does not replace a container for us: hooks and setup scripts run outside it, and the docs say it "isn't a boundary against the plugin's own code".
- **Hidden tests and our scorers.** Not possible inside a run. The docs say "There are no custom-code graders". The grader types are `regex`, `tool_used`, `tool_order`, `file_exists`, `llm` and `baseline`. Each run starts in an empty workspace. A starter project needs a bash setup script that runs only with `--scaffold`, under a 120-second limit. Scoring afterwards works: each run's `tracePath` points to a kept folder whose `home/cwd/` is the workspace, and the hidden tests ran there in an offline container. But that folder layout is undocumented and differs by OS. On Linux it is sealed with mode 000. On Windows it cannot be sealed, and the CLI warns not to run anything that loads configuration inside it.
- **Results.** `--output-dir` gets `aggregate-result.json` and a self-contained `report.html`. `--json <file>` writes the same JSON. The default folder is `<plugin>/evals/results/<timestamp>/`. With a claude.ai subscription login the report is also published to claude.ai as a private artifact, unless `--no-publish` is passed. Costs are list-price estimates.

## Decision

Keep the custom runner. `claude plugin eval` cannot run hidden tests or our scorers, and its results do not include token usage. Both can be reached only through debug folders whose layout is undocumented and differs by OS. Wrapping it would tie published numbers to that layout, in a command that Anthropic can switch off server-side. We would also still have to copy starter projects in, run every scorer and read every token count ourselves. The built-in runner would only spare us running the two arms.

The custom runner starts each run in a fresh Docker container. It runs `claude -p` in stream-json format, so one file holds both the transcript and the final result, including `modelUsage` with subagents. The custom scorers stay whichever runner is used.

Provider, models and isolation:

- The runner stays provider-neutral. It picks the Anthropic API or Amazon Bedrock from the environment, as before.
- Published results come from the Anthropic API, using a dedicated API key with a spending limit. Most Claude Code users run on the Anthropic API, so the numbers should reflect that setup. Exact model IDs and token billing are simpler there. On Bedrock, Claude Code maps the `sonnet` and `haiku` aliases to older models (Sonnet 4.5 and Haiku 4.5; see https://code.claude.com/docs/en/amazon-bedrock).
- The LLM judge uses an exact model ID, the same one as the runs, never an alias. `claude plugin eval --help` gives `haiku` as the default judge, and the docs give the background-task model.
- Full eval runs happen in Docker, whatever a runner's own sandbox offers. The permission mode is loosened only inside the container.

## Consequences

- We own a small amount of orchestration: running both arms, concurrency and a cost ceiling.
- Before relying on result field names, the runner records them from a real run. The provider the full runs use (the Anthropic API) must be verified with the runner. Bedrock stays supported but is untested until someone runs it.
- Revisit this decision if `claude plugin eval` adds graders that run commands and puts token usage in its results. It could then drive the runs while our scorers score them.
