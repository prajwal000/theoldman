// PreToolUse hook for the Write and Edit tools: blocks writes to env and private key files
// (rules/guard-write.ts). It stays on when theoldman is paused; only `disable` in
// .theoldman.json turns a rule off.

import { loadConfig } from '../lib/config.js';
import { readToolHookInput } from '../lib/input.js';
import { block, failOpen, pass, runHook } from '../lib/output.js';
import { checkPath } from '../rules/guard-write.js';

runHook(() => {
  const input = readToolHookInput();
  if (input === undefined || (input.tool_name !== 'Write' && input.tool_name !== 'Edit')) {
    return failOpen('invalid hook input');
  }
  const projectRoot = process.env.CLAUDE_PROJECT_DIR ?? input.cwd;
  const violation = checkPath(input.tool_input.file_path);
  if (violation === undefined || loadConfig(projectRoot).config.disable.includes(violation.id)) {
    return pass();
  }
  return block(`${violation.id}: ${violation.message}`);
});
