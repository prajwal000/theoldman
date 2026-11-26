// The switch behind /theoldman:off and /theoldman:on. Those skills run it as a pre-executed
// command (`oldman-pause.mjs off|on <project dir>`), so the model never makes the call, and
// OLDMAN-G08 blocks the model from running it through Bash or PowerShell. Pausing turns off the
// rules summary, the prompt rules, the edit checks and the review; the guards stay on.

import { failOpen, runHook, say } from '../lib/output.js';
import { setPaused } from '../lib/state.js';

runHook(() => {
  const [mode, projectDir = process.cwd()] = process.argv.slice(2);
  if (mode !== 'on' && mode !== 'off')
    return failOpen('usage: oldman-pause.mjs on|off [project dir]');
  setPaused(projectDir, mode === 'off');
  return say(
    mode === 'off'
      ? 'theoldman is paused for this project: the rules summary, prompt rules, edit checks and review are off. The guards stay on. Run /theoldman:on to resume.'
      : 'theoldman is on again for this project: the rules summary, prompt rules, edit checks and review are back.',
  );
});
