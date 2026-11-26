// PostToolUse hook for the Write and Edit tools: runs the Check rules (rules/check.ts) on the lines
// the edit added. Fix findings ask Claude to change the code (`decision: "block"` + reason) until
// the feedback cap for their check type is reached; after that they are recorded for the Stop
// summary instead. Warn findings go to Claude as additional context. Rules see paths relative to
// the project root, so folder-based exemptions only match folders inside the project. Pausing
// theoldman turns this hook off; the guards stay on.

import { readFileSync } from 'node:fs';
import { addedLinesForEdit, addedLinesForWrite } from '../lib/added-lines.js';
import { loadConfig } from '../lib/config.js';
import { readToolHookInput } from '../lib/input.js';
import { failOpen, fix, formatFindings, pass, runHook, warn } from '../lib/output.js';
import { isIgnored, toProjectRelative } from '../lib/paths.js';
import type { Finding } from '../lib/rules.js';
import {
  addRound,
  getRounds,
  isPaused,
  recordCappedFindings,
  recordTouchedFile,
} from '../lib/state.js';
import { CHECK_TYPES, checkType, runChecks } from '../rules/check.js';

// additionalContext and reason are capped by Claude Code at 10,000 characters.
const MAX_LISTED = 20;

function list(findings: readonly Finding[]): string {
  const more = findings.length - MAX_LISTED;
  return (
    formatFindings(findings.slice(0, MAX_LISTED)) +
    (more > 0 ? `\n...and ${String(more)} more.` : '')
  );
}

runHook(() => {
  const input = readToolHookInput();
  if (input === undefined || (input.tool_name !== 'Write' && input.tool_name !== 'Edit')) {
    return failOpen('invalid hook input');
  }
  const { session_id: session, tool_input: toolInput } = input;
  // Claude Code exports CLAUDE_PROJECT_DIR to every hook; cwd can be a subdirectory of it.
  const root = process.env.CLAUDE_PROJECT_DIR ?? input.cwd;
  const file = toProjectRelative(toolInput.file_path, root);
  recordTouchedFile(root, session, file);

  const { config } = loadConfig(root);
  if (isPaused(root) || isIgnored(toolInput.file_path, root, config.ignorePaths)) return pass();
  const content =
    input.tool_name === 'Write'
      ? input.tool_input.content
      : readFileSync(toolInput.file_path, 'utf8');
  const addedLines =
    input.tool_name === 'Write'
      ? addedLinesForWrite(toolInput.file_path, content)
      : addedLinesForEdit(input.tool_input, content);
  const findings = runChecks({ file, content, addedLines }, config.disable);

  const warnings = findings.filter((finding) => finding.action === 'warn');
  const blocking: Finding[] = [];
  const capped: Finding[] = [];
  for (const type of CHECK_TYPES) {
    const fixes = findings.filter((f) => f.action === 'fix' && checkType(f) === type);
    if (fixes.length === 0) continue;
    if (getRounds(root, session, type) < config.maxFeedbackRounds) {
      blocking.push(...fixes);
      addRound(root, session, type);
    } else {
      capped.push(...fixes);
    }
  }
  recordCappedFindings(root, session, file, formatFindings(capped).split('\n').filter(Boolean));

  const context = warnings.length > 0 ? list(warnings) : undefined;
  if (blocking.length > 0) return fix('PostToolUse', list(blocking), context);
  return context === undefined ? pass() : warn('PostToolUse', context);
});
