# 0008. Score security with pinned Semgrep rules and gitleaks in a separate scoring image

Date: 2026-11-27
Status: Accepted

## Context

The evals count security findings in each run with Semgrep and gitleaks. Both numbers get published, so they must come out the same on any machine and on any day, and they must not favour theoldman by construction.

Semgrep's results depend on the rules more than on Semgrep itself. The usual configs (`--config auto`, `p/default`, `p/typescript`) are fetched from the Semgrep Registry on every scan. They change over time, need the network while scoring, and `auto` sends metrics. Writing our own rules would be reproducible, but then theoldman would be graded by rules from the same author as its own rules.

Claude must not have these tools during a run, or the "with" and "without" arms would measure something else. Scoring rebuilds each run's project in a container (ADR 0007), so the tools belong in that container.

## Decision

- Semgrep runs the JavaScript and TypeScript rules of the public `semgrep/semgrep-rules` repository at one pinned commit (`SEMGREP_RULES_COMMIT` in `evals/src/images.ts`). The scoring image fetches that commit with git, which checks the content against the commit hash, and keeps only the rule files. The rules are not copied into this repository. Their license (Semgrep Rules License v1.0) travels with them in the image.
- Semgrep (`SEMGREP_VERSION`, from PyPI) and gitleaks (`GITLEAKS`, from its GitHub release, checked against the release's sha256 for amd64 and arm64) are pinned too. gitleaks uses its built-in rules, which are fixed by its version.
- `evals/docker/Dockerfile` has two targets. `agent` is the image runs use and is unchanged. `score` builds on it and adds the tools. The base image is still the pinned official `node` image only.
- Only findings the run caused count. Semgrep scans the files the run changed, and a finding counts if it covers a line the run added. gitleaks scans the run's changes as one commit. Findings keep the rule, file and line, never the matched text, so a detected secret is never stored.
- Scans run offline: `--metrics=off` and `--disable-version-check` for Semgrep, and no network use by gitleaks.

## Consequences

- Changing a pin changes what the security scores measure. Results from different pins should not be compared.
- New Semgrep registry rules reach the evals only when the commit is moved on purpose.
- The scoring image takes longer to build the first time (Python, Semgrep and the rules), then Docker caches it.
- Building the scoring image needs github.com and pypi.org. Scoring itself needs the network only for `npm install`, as before.
