---
name: on
description: Turn theoldman back on in this project after /theoldman:off. Run by the user as /theoldman:on.
disable-model-invocation: true
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/oldman-pause.mjs" *) PowerShell(node "${CLAUDE_PLUGIN_ROOT}/scripts/oldman-pause.mjs" *)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/oldman-pause.mjs" on "${CLAUDE_PROJECT_DIR}"`

Repeat the line above to the user as it is. Do not run any tools.
