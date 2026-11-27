# The image Claude Code runs in for every eval run (target `agent`), and the image scoring
# rebuilds projects in (target `score`). The runner passes the base image pinned by digest and
# every tool version (evals/src/images.ts); none has a default, so a build cannot fall back to an
# unpinned image or release.
ARG NODE_IMAGE
FROM ${NODE_IMAGE} AS agent

ARG CLAUDE_CODE_VERSION
ARG NPM_VERSION
RUN test -n "${CLAUDE_CODE_VERSION}" \
 && test -n "${NPM_VERSION}" \
 && apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g "npm@${NPM_VERSION}" \
 && npm install -g "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
 && npm cache clean --force \
 && mkdir /workspace /opt/theoldman \
 && chown node:node /workspace

# The runner copies the plugin into /opt/theoldman (root-owned, so the agent cannot change it).
# Claude Code refuses to skip permissions as root, and the agent has no reason to be root.
USER node
WORKDIR /workspace

# Scoring adds Semgrep and gitleaks in a separate stage, so the agent never has them during a run.
# gitleaks is checked against its release checksum. The Semgrep rules are fetched by commit, which
# git verifies, and only the JavaScript and TypeScript rule files are kept.
FROM agent AS score

ARG GITLEAKS_VERSION
ARG GITLEAKS_SHA256_AMD64
ARG GITLEAKS_SHA256_ARM64
ARG SEMGREP_VERSION
ARG SEMGREP_RULES_COMMIT
USER root
RUN test -n "${GITLEAKS_VERSION}" \
 && test -n "${GITLEAKS_SHA256_AMD64}" \
 && test -n "${GITLEAKS_SHA256_ARM64}" \
 && test -n "${SEMGREP_VERSION}" \
 && test -n "${SEMGREP_RULES_COMMIT}" \
 && apt-get update \
 && apt-get install -y --no-install-recommends curl python3 python3-venv \
 && rm -rf /var/lib/apt/lists/* \
 && case "$(dpkg --print-architecture)" in \
      amd64) arch=x64; sum="${GITLEAKS_SHA256_AMD64}" ;; \
      arm64) arch=arm64; sum="${GITLEAKS_SHA256_ARM64}" ;; \
      *) echo "no pinned gitleaks for $(dpkg --print-architecture)" >&2; exit 1 ;; \
    esac \
 && curl -fsSL -o /tmp/gitleaks.tar.gz \
    "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_${arch}.tar.gz" \
 && echo "${sum}  /tmp/gitleaks.tar.gz" | sha256sum -c - \
 && tar -xzf /tmp/gitleaks.tar.gz -C /usr/local/bin gitleaks \
 && rm /tmp/gitleaks.tar.gz \
 && python3 -m venv /opt/semgrep \
 && /opt/semgrep/bin/pip install --no-cache-dir --disable-pip-version-check "semgrep==${SEMGREP_VERSION}" \
 && ln -s /opt/semgrep/bin/semgrep /usr/local/bin/semgrep \
 && git init -q /tmp/rules \
 && git -C /tmp/rules fetch -q --depth 1 https://github.com/semgrep/semgrep-rules.git "${SEMGREP_RULES_COMMIT}" \
 && git -C /tmp/rules checkout -q FETCH_HEAD \
 && test "$(git -C /tmp/rules rev-parse HEAD)" = "${SEMGREP_RULES_COMMIT}" \
 && mkdir /opt/semgrep-rules \
 && cp -r /tmp/rules/javascript /tmp/rules/typescript /tmp/rules/LICENSE /opt/semgrep-rules/ \
 && find /opt/semgrep-rules -type f ! -name '*.yaml' ! -name '*.yml' ! -name LICENSE -delete \
 && rm -rf /tmp/rules
USER node
