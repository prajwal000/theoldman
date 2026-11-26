---
name: off
description: Pause theoldman in this project. Turns off the rules summary, prompt rules, edit checks and review; the guards stay on. Run by the user as /theoldman:off.
disable-model-invocation: true
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/oldman-pause.mjs" *) PowerShell(node "${CLAUDE_PLUGIN_ROOT}/scripts/oldman-pause.mjs" *)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/oldman-pause.mjs" off "${CLAUDE_PROJECT_DIR}"`

Repeat the line above to the user as it is. Do not run any tools.
