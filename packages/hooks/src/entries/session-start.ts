// SessionStart hook: gives Claude the core rules and the project's stack once per session. It also
// runs after /clear and compaction, so the rules survive a context that was cut down. The rule
// text is read from the oldman-rules skill (lib/tell.ts), which ships next to this script. It
// also records which files already differ from git, so the Stop hook can tell the session's
// changes from the user's earlier uncommitted work (lib/session-changes.ts).

import { fileURLToPath } from 'node:url';
import { loadConfig } from '../lib/config.js';
import { isCommonInput, readHookInput } from '../lib/input.js';
import { failOpen, runHook, warn } from '../lib/output.js';
import { recordBaseline } from '../lib/session-changes.js';
import { detectStack } from '../lib/stack.js';
import { isPaused } from '../lib/state.js';
import { readTellSections } from '../lib/tell.js';

const HEADER = 'theoldman core rules (the oldman-rules skill has the full text):';
const PAUSED = 'theoldman is paused: the guards stay on; rules, checks and review are off.';
const QUICK =
  'theoldman level is quick: guards and edit checks are on, the rules summary and review are off.';

function stackLine(projectDir: string, configured: readonly string[]): string {
  if (configured.length > 0) return `Stack (from .theoldman.json): ${configured.join(', ')}.`;
  const detected = detectStack(projectDir);
  return detected.length > 0
    ? `Stack (from package.json): ${detected.join(', ')}.`
    : 'Stack: nothing detected from package.json.';
}

runHook(() => {
  const input = readHookInput(isCommonInput);
  if (input === undefined) return failOpen('invalid hook input');
  // Claude Code exports CLAUDE_PROJECT_DIR to every hook; cwd can be a subdirectory of it.
  const root = process.env.CLAUDE_PROJECT_DIR ?? input.cwd;
  try {
    recordBaseline(root, input.session_id);
  } catch {
    // Without a baseline the Stop hook still reviews files Write and Edit touched; the rules
    // summary matters more than failing here.
  }
  const { config, warning } = loadConfig(root);
  const notes = warning === undefined ? [] : [`theoldman: ${warning}`];
  if (isPaused(root)) return warn('SessionStart', [...notes, PAUSED].join('\n'));
  if (config.level === 'quick') return warn('SessionStart', [...notes, QUICK].join('\n'));

  const pluginRoot = fileURLToPath(new URL('..', import.meta.url));
  const rules = readTellSections(pluginRoot).get('core') ?? [];
  if (rules.length === 0) return failOpen('no core rules found in the oldman-rules skill');
  const lines = [...notes, HEADER, ...rules, stackLine(root, config.stack)];
  return warn('SessionStart', lines.join('\n'));
});
