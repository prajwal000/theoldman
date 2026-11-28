// Containers left behind when a run or a scoring session was killed outright (a kill skips the
// Ctrl+C cleanup). Every container the evals start carries the label theoldman.owner=<pid>; the
// next run or scoring session removes those whose owner process is gone, Compose projects whole.

import type { DockerExec } from './docker.ts';

export const OWNER_LABEL = 'theoldman.owner';

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to someone else.
    return error instanceof Error && 'code' in error && error.code === 'EPERM';
  }
}

/** Removes containers whose owner process has exited, and returns what it removed. */
export async function removeOrphans(
  docker: DockerExec,
  env: NodeJS.ProcessEnv,
  isAlive: (pid: number) => boolean = processAlive,
): Promise<string[]> {
  const format = `{{.ID}}\t{{.Names}}\t{{.Label "${OWNER_LABEL}"}}\t{{.Label "com.docker.compose.project"}}`;
  const listed = await docker(
    ['ps', '-a', '--filter', `label=${OWNER_LABEL}`, '--format', format],
    { env, timeoutMs: 30_000 },
  );
  if (listed.code !== 0) return [];

  const projects = new Set<string>();
  const containers: { id: string; name: string }[] = [];
  for (const line of listed.stdout.split('\n').filter((entry) => entry.trim() !== '')) {
    const [id = '', name = '', owner = '', project = ''] = line.trim().split('\t');
    const pid = Number(owner);
    // An owner of 0 or garbage is unknown, not dead: leave it alone.
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid || isAlive(pid)) continue;
    if (project !== '') projects.add(project);
    else containers.push({ id, name });
  }

  const removed: string[] = [];
  for (const project of projects) {
    const down = ['compose', '-p', project, 'down', '-v', '--remove-orphans', '-t', '0'];
    if ((await docker(down, { env, timeoutMs: 2 * 60_000 })).code === 0) removed.push(project);
  }
  for (const { id, name } of containers) {
    if ((await docker(['rm', '-f', id], { env, timeoutMs: 60_000 })).code === 0) removed.push(name);
  }
  return removed;
}
