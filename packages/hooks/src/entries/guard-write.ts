// PreToolUse hook for the Write and Edit tools: blocks writes to env and private key files,
// writes by the docs-writer subagent outside documentation files (rules/guard-write.ts), and
// content that holds a secret (rules/secrets.ts). Messages name the file and line, never the
// secret. It stays on when theoldman is paused; only `disable` in .theoldman.json turns a rule off.

import { readFileSync } from 'node:fs';
import { lineOffset } from '../lib/added-lines.js';
import { loadConfig } from '../lib/config.js';
import { readToolHookInput } from '../lib/input.js';
import { block, failOpen, pass, runHook } from '../lib/output.js';
import type { Violation } from '../rules/guard-context.js';
import { checkAgentPath, checkPath } from '../rules/guard-write.js';
import { scanSecrets, secretMessage } from '../rules/secrets.js';

const MAX_LISTED = 5;

/** Lines of the file before the text an Edit replaces, so findings use file line numbers. */
function editOffset(file: string, oldString: string): number {
  try {
    return lineOffset(readFileSync(file, 'utf8'), oldString) ?? 0;
  } catch {
    // A file we cannot read yet: number lines from the start of the new text.
    return 0;
  }
}

runHook(() => {
  const input = readToolHookInput();
  if (input === undefined || (input.tool_name !== 'Write' && input.tool_name !== 'Edit')) {
    return failOpen('invalid hook input');
  }
  const file = input.tool_input.file_path;
  const [text, offset] =
    input.tool_name === 'Write'
      ? [input.tool_input.content, 0]
      : [input.tool_input.new_string, editOffset(file, input.tool_input.old_string)];
  const secrets = scanSecrets(text).map((finding): Violation => ({
    id: 'OLDMAN-S01',
    message: secretMessage(file, { ...finding, line: finding.line + offset }),
  }));
  // Claude Code exports CLAUDE_PROJECT_DIR to every hook; cwd can be a subdirectory of it.
  const root = process.env.CLAUDE_PROJECT_DIR ?? input.cwd;
  const { disable } = loadConfig(root).config;
  const agentPath = checkAgentPath(file, root, input.agent_type, input.cwd);
  const violations = [checkPath(file), agentPath, ...secrets].filter(
    (violation): violation is Violation =>
      violation !== undefined && !disable.includes(violation.id),
  );
  if (violations.length === 0) return pass();
  const listed = violations.slice(0, MAX_LISTED).map(({ id, message }) => `${id}: ${message}`);
  const more = violations.length - listed.length;
  return block([...listed, ...(more > 0 ? [`...and ${String(more)} more.`] : [])].join('\n'));
});
