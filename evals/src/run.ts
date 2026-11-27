// Command-line entry: pnpm --filter evals run eval --task <id> --condition with|without ...
// Problems with the input are printed as one message with exit code 1; anything else is a bug and
// keeps its stack trace.

import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRunArgs, USAGE } from './args.ts';
import { ConfigError } from './errors.ts';
import { PLAN_FILE, planRun } from './plan.ts';

const evalsDir = fileURLToPath(new URL('..', import.meta.url));
const repoDir = join(evalsDir, '..');

try {
  const args = parseRunArgs(process.argv.slice(2));
  if (args === undefined) {
    process.stdout.write(`${USAGE}\n`);
  } else {
    const { dir, plan } = planRun(args, process.env, {
      tasksDir: join(evalsDir, 'tasks'),
      runsDir: join(evalsDir, 'runs'),
    });
    const runs = `${String(plan.runs)} run${plan.runs === 1 ? '' : 's'}`;
    process.stdout.write(
      `Dry run: task ${plan.task.id}, condition ${plan.condition}, ${runs}, provider ${plan.provider.name}.\n` +
        `Planned run written to ${relative(repoDir, join(dir, PLAN_FILE))}\n`,
    );
  }
} catch (error) {
  if (!(error instanceof ConfigError)) throw error;
  process.stderr.write(`eval: ${error.message}\n`);
  process.exitCode = 1;
}
