// Writes the current branch's changes to .theoldman/state/<session>/diff.patch for
// /theoldman:review, which runs it as a pre-executed command
// (`oldman-review-diff.mjs <session id> <project dir>`) and then has the reviewer and verifier
// subagents read the file. The diff is against where the branch left the default branch, and
// includes uncommitted and untracked files; on the default branch it is the uncommitted work.

import { fileURLToPath } from 'node:url';
import { parseDiff, workingTreeDiff } from '../lib/diff.js';
import { branchBase } from '../lib/git.js';
import { runHook, say } from '../lib/output.js';
import { reviewSkills, sessionCategories, writeReviewRules } from '../lib/review-scope.js';
import { writeSessionFile } from '../lib/state.js';

runHook(() => {
  const [sessionId = '', projectDir = process.cwd()] = process.argv.slice(2);
  const base = branchBase(projectDir);
  let diff: string;
  try {
    diff = workingTreeDiff(projectDir, undefined, base?.commit ?? 'HEAD');
  } catch {
    // Not a git repository, or git could not run: there is no branch to compare.
    return say('This project is not a git repository, so there is no branch diff to review.');
  }
  const against =
    base === undefined ? 'the last commit' : `${base.branch} (from ${base.commit.slice(0, 7)})`;
  const files = parseDiff(diff).length;
  if (files === 0) return say(`No changes against ${against}, so there is nothing to review.`);
  const path = writeSessionFile(projectDir, sessionId, 'diff.patch', diff);
  const changed = parseDiff(diff).map((file) => file.path);
  const skills = reviewSkills(changed, sessionCategories(projectDir, sessionId));
  const pluginRoot = fileURLToPath(new URL('..', import.meta.url));
  const rules = writeReviewRules(pluginRoot, projectDir, sessionId, skills);
  const summary = `Diff of ${String(files)} changed file(s) against ${against} written to ${path}`;
  return say(rules === undefined ? summary : `${summary}\nTopic rules for this change: ${rules}`);
});
