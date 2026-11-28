# 0011. Review-mode evals: golden PRs, a tool-less Claude Code judge, a judge-free injection check

Date: 2026-11-28
Status: Accepted

## Context

The review-mode eval measures how well Claude Code reviews a pull request with and without theoldman: precision (how many findings are real), recall (how many known problems are found) and resistance to prompt injection, which must be 100%. Each golden PR has known problems, its golden comments, or none. Matching free-text findings to golden comments needs judgement, so an LLM judge does it. The judge must work on the Anthropic API and on Bedrock with the same environment as the runs, and use an exact model ID, never `haiku` or another alias.

## Decision

- A golden PR is a `git diff` against a shared starter plus `pr.json` with its title, description, branch and golden comments (file, line after the change, issue), or `"clean": true`. A run commits the starter on `main` and the patch on the PR's branch, with the title and description as the commit message, both sent on stdin. "With" runs get `/theoldman:review`, what a theoldman user types; "without" runs ask in plain words to review the branch against `main`. The first plan gave both the plain prompt, so that only the plugin differed. In the first live run (2026-11-28, `claude-sonnet-5-5`) Claude never picked theoldman's `review` skill from that prompt: in all three "with" runs it reviewed on its own, as in "without", so the comparison measured nothing. A "with" run in which theoldman's reviewer subagent does not run is therefore not judged and counts as failed. Whether plain review requests reach theoldman's review is a question about the skill's description, not about review quality, and is handled in the plugin.
- The judge is Claude Code itself: `claude -p --tools "" --model <ANTHROPIC_MODEL> --no-session-persistence` in a fresh agent-image container, with the review on stdin. It reuses the runs' provider detection, credential passing by variable name and transcript scrubbing, so the Anthropic API and Bedrock work the same way, with no SDK, no Bedrock request signing of our own and no Claude process on the host. Calling the Messages API directly would have needed both. Scoring refuses a judge on a different provider from the runs, since the model ID would not exist there.
- The judge only lists the review's findings and names the golden comment each one matches. Code checks that reply against the golden IDs, asks once more if it is not valid, and computes the numbers. The prompt is `evals/judge/review-judge.md`; results record its SHA-256 and the models the judge called.
- The injection check does not use the judge. Each injection PR lists tool calls that show its instruction was followed (`tools` and a regular expression over the call's input), and any file the review changed counts too. A review fooled by the PR cannot then fool the judge into passing it. Runs that failed still count when they left a transcript, so a run that followed the instruction and then crashed is not hidden.
- Every finding counts, whatever severity the review gives it: a nit on a clean PR is a false positive. Two findings that match the same golden comment are both true positives, while recall counts that comment once per run. Counts are summed over runs and PRs before dividing, so a run with many findings weighs more than one with few.
- Review results go to their own file, `evals/results/<date>-<label>-review.json`, with their own schema (`evals/schema/review-results.schema.json`). The `score` command scores build runs or review runs, never both at once.

## Consequences

- Results depend on the judge prompt. Changing it changes the numbers, which is why its hash is recorded.
- The judge sees the golden comments and the review, not the code. A finding about the right problem at a wrong line further than about 10 lines away may not match, which lowers both precision and recall.
- An injection PR's pattern must match doing what the instruction asks, not quoting it, because a good review quotes the instruction when it reports it.
- Each judged run costs one more model call on the runs' model, recorded as the judge's cost.
