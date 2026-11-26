// UserPromptSubmit hook: puts the prompt in up to two categories by keyword (lib/router.ts) and
// gives Claude at most four rule lines for them, from the oldman-rules skill's tell.md. A prompt
// with no category, such as "thanks", gets nothing. No model call, so it adds no delay or cost.
// It records the categories for the session, so the Stop review can pick its topic skills.

import { fileURLToPath } from 'node:url';
import { isPromptHookInput, readHookInput } from '../lib/input.js';
import { failOpen, pass, runHook, warn } from '../lib/output.js';
import { recordCategories } from '../lib/review-scope.js';
import { classify, pickLines } from '../lib/router.js';
import { isPaused } from '../lib/state.js';
import { readTellSections } from '../lib/tell.js';

const MAX_CATEGORIES = 2;
const MAX_LINES = 4;

runHook(() => {
  const input = readHookInput(isPromptHookInput);
  if (input === undefined) return failOpen('invalid hook input');
  // Claude Code exports CLAUDE_PROJECT_DIR to every hook; cwd can be a subdirectory of it.
  const root = process.env.CLAUDE_PROJECT_DIR ?? input.cwd;
  if (isPaused(root)) return pass();
  const found = classify(input.prompt);
  try {
    recordCategories(root, input.session_id, found);
  } catch {
    // The Stop review then picks skills from the changed files alone; the rule lines matter more.
  }
  const categories = found.slice(0, MAX_CATEGORIES);
  if (categories.length === 0) return pass();

  const sections = readTellSections(fileURLToPath(new URL('..', import.meta.url)));
  const lines = pickLines(
    categories.map((category) => sections.get(category) ?? []),
    MAX_LINES,
  );
  if (lines.length === 0) return failOpen(`no rules for ${categories.join(', ')} in tell.md`);
  const header = `theoldman rules for this prompt (${categories.join(', ')}):`;
  return warn('UserPromptSubmit', [header, ...lines].join('\n'));
});
