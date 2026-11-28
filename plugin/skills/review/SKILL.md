---
name: review
description: theoldman's code review. Reviews the current branch against the default branch, including uncommitted work, with theoldman's reviewer and verifier subagents, and reports only the findings it confirmed. Use whenever the user asks for a review of their code changes, in any words, such as "review this branch", "review my changes", "check this before I merge" or "look over this pull request", or runs /theoldman:review. Use it instead of reviewing the diff yourself or with another review skill.
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
