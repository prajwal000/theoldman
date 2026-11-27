# The image Claude Code runs in for every eval run. The runner passes the base image pinned by
# digest (evals/src/images.ts) and the Claude Code version; neither has a default, so a build
# cannot fall back to an unpinned image or the latest release.
ARG NODE_IMAGE
FROM ${NODE_IMAGE}

ARG CLAUDE_CODE_VERSION
RUN test -n "${CLAUDE_CODE_VERSION}" \
 && apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
 && npm cache clean --force \
 && mkdir /workspace /opt/theoldman \
 && chown node:node /workspace

# The runner copies the plugin into /opt/theoldman (root-owned, so the agent cannot change it).
# Claude Code refuses to skip permissions as root, and the agent has no reason to be root.
USER node
WORKDIR /workspace
