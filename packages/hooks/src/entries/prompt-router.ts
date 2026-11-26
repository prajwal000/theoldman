// UserPromptSubmit hook: puts the prompt in up to two categories by keyword (lib/router.ts) and
// gives Claude at most four rule lines for them, from the oldman-rules skill's tell.md. A prompt
// with no category, such as "thanks", gets nothing. No model call, so it adds no delay or cost.

import { fileURLToPath } from 'node:url';
import { isPromptHookInput, readHookInput } from '../lib/input.js';
import { failOpen, pass, runHook, warn } from '../lib/output.js';
import { classify, pickLines } from '../lib/router.js';
import { isPaused } from '../lib/state.js';
import { readTellSections } from '../lib/tell.js';

const MAX_CATEGORIES = 2;
const MAX_LINES = 4;

runHook(() => {
  const input = readHookInput(isPromptHookInput);
  if (input === undefined) return failOpen('invalid hook input');
  // Claude Code exports CLAUDE_PROJECT_DIR to every hook; cwd can be a subdirectory of it.
  if (isPaused(process.env.CLAUDE_PROJECT_DIR ?? input.cwd)) return pass();
  const categories = classify(input.prompt).slice(0, MAX_CATEGORIES);
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
