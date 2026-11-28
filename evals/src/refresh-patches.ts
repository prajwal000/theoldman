// Command-line entry: pnpm --filter evals run refresh-patches [-- --from <git ref>] [<task>...]
// After changing a starter, moves every task's reference.patch onto it (see patches.ts). <git ref>
// is where the patches last applied, HEAD by default, so run it before committing the starter
// change. Then run verify-tasks. Needs Docker, but no model provider.

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAgentImage, dockerExec, requireDocker } from './docker.ts';
import { ConfigError } from './errors.ts';
import { refreshPatch } from './patches.ts';
import { dockerEnv } from './secrets.ts';
import { loadTask } from './task.ts';

const evalsDir = fileURLToPath(new URL('..', import.meta.url));
const repoRoot = join(evalsDir, '..');
const tasksDir = join(evalsDir, 'tasks');
const dockerDir = join(evalsDir, 'docker');

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((arg) => arg !== '--');
  const at = args.indexOf('--from');
  const fromRef = at === -1 ? 'HEAD' : args[at + 1];
  if (fromRef === undefined || fromRef.startsWith('-')) {
    throw new ConfigError('--from needs a git ref, such as HEAD or main.');
  }
  const named = args.filter((_, index) => at === -1 || (index !== at && index !== at + 1));
  const ids =
    named.length > 0
      ? named
      : readdirSync(tasksDir, { withFileTypes: true })
          .filter((entry) => entry.isDirectory() && entry.name !== '_template')
          .map((entry) => entry.name)
          .sort();

  const env = dockerEnv(process.env);
  await requireDocker(dockerExec, env);
  await buildAgentImage(dockerExec, dockerDir, env, []);
  let conflicts = 0;
  for (const id of ids) {
    const task = loadTask(tasksDir, id);
    const outcome = await refreshPatch(dockerExec, { task, repoRoot, fromRef, dockerDir }, env);
    if (outcome === 'conflict') conflicts += 1;
    process.stdout.write(`${id}: ${outcome}\n`);
  }
  if (conflicts > 0) {
    process.stdout.write(
      `${String(conflicts)} patches conflict with the starter change; update those by hand.\n`,
    );
    process.exitCode = 1;
  }
}

try {
  await main();
} catch (error) {
  if (error instanceof ConfigError) {
    process.stderr.write(`refresh-patches: ${error.message}\n`);
    process.exitCode = 1;
  } else {
    throw error;
  }
}
