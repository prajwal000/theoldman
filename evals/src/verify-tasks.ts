// Command-line entry: pnpm --filter evals run verify-tasks [-- <task>...]
// Scores every task's untouched starter and reference.patch, and fails unless each starter fails
// all its hidden tests and each reference passes them with no findings. Run it after changing a
// starter, hidden tests or scoring. Needs Docker, but no model provider.

import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dockerExec, InterruptedError } from './docker.ts';
import { ConfigError } from './errors.ts';
import { abortOnInterrupt, INTERRUPTED_EXIT } from './interrupt.ts';
import { verifyTasks } from './score/verify.ts';
import { loadTask } from './task.ts';

const evalsDir = fileURLToPath(new URL('..', import.meta.url));
const tasksDir = join(evalsDir, 'tasks');

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((arg) => arg !== '--');
  if (args.includes('--help')) {
    process.stdout.write('Usage: pnpm --filter evals run verify-tasks [-- <task>...]\n');
    return;
  }
  const ids =
    args.length > 0
      ? args
      : readdirSync(tasksDir, { withFileTypes: true })
          .filter((entry) => entry.isDirectory() && entry.name !== '_template')
          .map((entry) => entry.name)
          .sort();
  const tasks = ids.map((id) => loadTask(tasksDir, id));
  const workDir = mkdtempSync(join(tmpdir(), 'theoldman-verify-'));
  const controller = abortOnInterrupt();
  try {
    const verdicts = await verifyTasks({
      tasks,
      dockerDir: join(evalsDir, 'docker'),
      env: process.env,
      docker: dockerExec,
      workDir,
      signal: controller.signal,
      progress: (line) => process.stdout.write(`${line}\n`),
    });
    const failing = verdicts.filter((verdict) => verdict.problems.length > 0);
    process.stdout.write(
      `\n${String(verdicts.length - failing.length)} of ${String(verdicts.length)} checks passed.\n`,
    );
    for (const { task, kind, problems } of failing) {
      process.stdout.write(`FAIL ${task} ${kind}: ${problems.join('; ')}\n`);
    }
    if (failing.length > 0) process.exitCode = 1;
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

try {
  await main();
} catch (error) {
  if (error instanceof InterruptedError) {
    process.stderr.write('verify-tasks: interrupted.\n');
    process.exitCode = INTERRUPTED_EXIT;
  } else if (error instanceof ConfigError) {
    process.stderr.write(`verify-tasks: ${error.message}\n`);
    process.exitCode = 1;
  } else {
    throw error;
  }
}
