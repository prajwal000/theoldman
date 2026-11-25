// PreToolUse hook for the Bash and PowerShell tools: blocks the commands in rules/guard-bash.ts.
// It stays on when theoldman is paused; only `disable` in .theoldman.json turns a rule off.

import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../lib/config.js';
import { readDotenv } from '../lib/dotenv.js';
import { currentBranch, defaultBranch } from '../lib/git.js';
import { readToolHookInput } from '../lib/input.js';
import { block, failOpen, pass, runHook } from '../lib/output.js';
import { checkCommand } from '../rules/guard-bash.js';

runHook(() => {
  const input = readToolHookInput();
  if (input === undefined || (input.tool_name !== 'Bash' && input.tool_name !== 'PowerShell')) {
    return failOpen('invalid hook input');
  }
  const { cwd } = input;
  // Claude Code exports CLAUDE_PROJECT_DIR to every hook; cwd can be a subdirectory of it.
  const projectRoot = process.env.CLAUDE_PROJECT_DIR ?? cwd;
  const { disable } = loadConfig(projectRoot).config;
  const violations = checkCommand(
    input.tool_input.command,
    input.tool_name === 'PowerShell' ? 'powershell' : 'bash',
    {
      cwd,
      projectRoot,
      home: homedir(),
      env: (name) => process.env[name],
      dotenv: (name) => readDotenv(join(projectRoot, '.env'), name),
      currentBranch: () => currentBranch(cwd),
      defaultBranch: (remote) => defaultBranch(cwd, remote),
    },
  ).filter((violation) => !disable.includes(violation.id));
  if (violations.length === 0) return pass();
  return block(violations.map(({ id, message }) => `${id}: ${message}`).join('\n'));
});
