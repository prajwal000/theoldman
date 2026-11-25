// PreToolUse hook for the Bash and PowerShell tools: blocks the commands in rules/guard-bash.ts.
// It stays on when theoldman is paused; only `disable` in .theoldman.json turns a rule off.

import { loadConfig } from '../lib/config.js';
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
  const { disable } = loadConfig(cwd).config;
  const violations = checkCommand(
    input.tool_input.command,
    input.tool_name === 'PowerShell' ? 'powershell' : 'bash',
    {
      currentBranch: () => currentBranch(cwd),
      defaultBranch: (remote) => defaultBranch(cwd, remote),
    },
  ).filter((violation) => !disable.includes(violation.id));
  if (violations.length === 0) return pass();
  return block(violations.map(({ id, message }) => `${id}: ${message}`).join('\n'));
});
