---
name: review
description: Review the current branch against the default branch with theoldman's reviewer and verifier subagents, and report the confirmed findings. Use when the user asks to review the branch, the changes or a pull request before it is opened, or runs /theoldman:review.
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/oldman-review-diff.mjs" *) PowerShell(node "${CLAUDE_PLUGIN_ROOT}/scripts/oldman-review-diff.mjs" *)
---

# Review the branch

The diff script has already run:

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/oldman-review-diff.mjs" "${CLAUDE_SESSION_ID}" "${CLAUDE_PROJECT_DIR}"`

If the output above does not say a diff was written, tell the user that in one line and stop.

Otherwise:

1. Run the `theoldman:oldman-reviewer` subagent with the prompt: Review the diff at `<the diff path above>`. If the output names a topic rules file, add: Read the topic rules in `<that path>` first.
2. If the reviewer's reply is exactly "No issues found.", tell the user that and skip the rest. Otherwise run the `theoldman:oldman-verifier` subagent with the same diff path, the rules path if there is one, and the reviewer's full reply.
3. Report only the verifier's confirmed findings to the user, Critical first, then Important, then Nits, each with its `file:line`, the failure scenario and the suggested fix. Say how many findings the verifier dropped. If none were confirmed, say "No issues found."

Do not change any code unless the user asked for fixes ($ARGUMENTS). If they did, fix the confirmed Critical and Important findings and run the tests.
