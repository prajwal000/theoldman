// Stop hook: when this session changed code, asks Claude once to have the diff reviewed and to fix
// what the review confirms, and runs the docs rules (rules/docs.ts) on the same diff. How much
// review depends on the change (lib/review-scope.ts): none for docs or tests only, a light
// self-review for a small change, the reviewer and verifier subagents with the matching topic
// rules otherwise. It never makes Claude loop: it stays quiet while
// Claude is already continuing because a Stop hook blocked (stop_hook_active), asks at most
// maxFeedbackRounds times per session, and does not ask again about a diff it already handled.
// Warnings never go in additionalContext, which on Stop forces another turn: they go in the
// block reason, or to the user only as a systemMessage.

import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { CONFIG_FILE, loadConfig } from '../lib/config.js';
import { newFileDiff, parseDiff, workingTreeDiff } from '../lib/diff.js';
import { isRecord, isStopHookInput, readHookInput } from '../lib/input.js';
import { failOpen, fix, formatFindings, notify, pass, runHook } from '../lib/output.js';
import { isIgnored } from '../lib/paths.js';
import {
  reviewKind,
  reviewSkills,
  sessionCategories,
  writeReviewRules,
} from '../lib/review-scope.js';
import { sessionChanges } from '../lib/session-changes.js';
import {
  addRound,
  cappedFindings,
  getRounds,
  isPaused,
  readSessionJson,
  writeSessionFile,
  writeSessionJson,
} from '../lib/state.js';
import { blockReason, userNotice } from '../lib/stop-report.js';
import { buildDocsContext } from '../rules/docs-context.js';
import { checkDocs } from '../rules/docs.js';

// The hashes of the last diff the hook handled and the last notice it showed.
const REVIEW_STATE = 'review.json';

const hash = (text: string): string => createHash('sha256').update(text).digest('hex');

function sessionDiff(projectDir: string, paths: readonly string[]): string {
  try {
    return workingTreeDiff(projectDir, paths);
  } catch {
    // Not a git repository: show each changed file as new.
    return paths.map((path) => newFileDiff(projectDir, path)).join('');
  }
}

runHook(() => {
  const input = readHookInput(isStopHookInput);
  if (input === undefined) return failOpen('invalid hook input');
  const session = input.session_id;
  // Claude Code exports CLAUDE_PROJECT_DIR to every hook; cwd can be a subdirectory of it.
  const root = process.env.CLAUDE_PROJECT_DIR ?? input.cwd;
  if (isPaused(root)) return pass();
  const { config } = loadConfig(root);
  // theoldman's own config is not code to review, nor are paths the user told it to ignore.
  const paths = sessionChanges(root, session).filter(
    (path) => path !== CONFIG_FILE && !isIgnored(path, root, config.ignorePaths),
  );
  if (paths.length === 0) return pass();
  const diff = sessionDiff(root, paths);
  const kind = reviewKind(parseDiff(diff), config.review.lightMaxLines);
  if (kind === 'none') return pass();

  const stored = readSessionJson(root, session, REVIEW_STATE);
  const state = (key: string): unknown => (isRecord(stored) ? stored[key] : undefined);
  const save = (reviewed: string, notified = state('notified')): void => {
    writeSessionJson(root, session, REVIEW_STATE, { reviewed, notified });
  };
  const diffHash = hash(diff);
  if (input.stop_hook_active) {
    // Claude is finishing what a Stop hook asked for; the result counts as handled.
    if (state('reviewed') !== undefined) save(diffHash);
    return pass();
  }
  if (state('reviewed') === diffHash) return pass();

  const summary = input.last_assistant_message ?? '';
  const findings = checkDocs(buildDocsContext(root, diff, summary)).filter(
    (finding) => !config.disable.includes(finding.id),
  );
  const fixes = findings.filter((finding) => finding.action === 'fix');
  const notes = findings.filter((finding) => finding.action !== 'fix');
  const capped = Object.values(cappedFindings(root, session)).flat();
  const max = config.maxFeedbackRounds;
  const wantsReview = config.level !== 'quick' && config.review.onStop;
  const review = wantsReview && getRounds(root, session, 'review') < max;
  const docsFix = fixes.length > 0 && getRounds(root, session, 'docs') < max;

  if (review || docsFix) {
    const diffPath = review ? writeSessionFile(root, session, 'diff.patch', diff) : undefined;
    const skills =
      review && kind === 'full' ? reviewSkills(paths, sessionCategories(root, session)) : [];
    const rulesPath = writeReviewRules(
      fileURLToPath(new URL('..', import.meta.url)),
      root,
      session,
      skills,
    );
    if (review) addRound(root, session, 'review');
    if (docsFix) addRound(root, session, 'docs');
    save(diffHash);
    const leftFixes = docsFix || fixes.length === 0 ? [] : formatFindings(fixes).split('\n');
    const left = [...capped, ...leftFixes];
    const report = { kind, diffPath, rulesPath, fixes: docsFix ? fixes : [], capped: left, notes };
    return fix('Stop', blockReason(report));
  }
  const skipped = wantsReview
    ? `this session already had ${String(max)} reviews (maxFeedbackRounds)`
    : undefined;
  const notice = userNotice({ fixes, capped, notes }, skipped);
  if (notice === undefined || state('notified') === hash(notice)) {
    save(diffHash);
    return pass();
  }
  save(diffHash, hash(notice));
  return notify(notice);
});
