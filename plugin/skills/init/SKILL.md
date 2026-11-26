---
name: init
description: Set up theoldman in this project. Writes .theoldman.json with the detected stack and adds a short theoldman section to CLAUDE.md. Run by the user as /theoldman:init.
disable-model-invocation: true
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/oldman-init.mjs" *) PowerShell(node "${CLAUDE_PLUGIN_ROOT}/scripts/oldman-init.mjs" *)
---

# Set up theoldman

The setup script has already run. Its report:

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/oldman-init.mjs" "${CLAUDE_PROJECT_DIR}"`

Tell the user, in two or three lines, what changed according to the report. Then say they can edit `.theoldman.json` to adjust `stack`, `level` (`quick`, `standard` or `strict`), `disable` and `ignorePaths`. Do not run any tools and do not change any files yourself.
