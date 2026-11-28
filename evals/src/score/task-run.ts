// Inspects one run of a task in a scoring container: with a fresh Postgres for a task that uses
// it, removed again whatever happens. Scoring and task verification both go through here, so a
// reference solution is checked exactly the way a run is scored.

import { join } from 'node:path';
import { buildScoreImage, type DockerExec, pullFirst, requireDocker } from '../docker.ts';
import { IMAGES, imageRefs } from '../images.ts';
import { removeOrphans } from '../orphans.ts';
import type { Task } from '../task.ts';
import { startDatabase } from './database.ts';
import { warmNpmCache } from './npm-cache.ts';
import { inspectWorkspace, type WorkspaceReport } from './workspace.ts';

export interface Prepared {
  /** The pinned Postgres reference, pulled when any of the tasks uses it. */
  readonly postgresImage: string | undefined;
  /** Things that did not stop scoring but slow it or are worth knowing, such as a cold cache. */
  readonly problems: readonly string[];
}

/**
 * Everything scoring needs before the first container: Docker running, containers left by a
 * killed session removed, the scoring image built, the npm cache warmed and Postgres pulled.
 */
export async function prepareScoring(
  docker: DockerExec,
  input: { readonly dockerDir: string; readonly tasks: readonly Task[] },
  env: NodeJS.ProcessEnv,
  signal?: AbortSignal,
  progress?: (line: string) => void,
): Promise<Prepared> {
  await requireDocker(docker, env);
  for (const name of await removeOrphans(docker, env)) {
    progress?.(`removed ${name}, left by an interrupted run`);
  }
  await buildScoreImage(docker, input.dockerDir, env, signal);
  const problems = await warmNpmCache(
    docker,
    input.tasks.map((task) => task.starterDirs),
    env,
    signal,
  );
  const postgresImage = input.tasks.some((task) => task.services.includes('postgres'))
    ? await pullFirst(docker, imageRefs(IMAGES.postgres), env, signal)
    : undefined;
  return { postgresImage, problems };
}

export interface TaskRunInput {
  readonly task: Task;
  /** A folder holding the run's diff.patch. */
  readonly runDir: string;
  /** Names the container and, for Postgres, its Compose project. */
  readonly name: string;
  readonly dockerDir: string;
  /** The pinned Postgres reference that was pulled, when any task needs it. */
  readonly postgresImage: string | undefined;
}

/** A container or Compose project name: lowercase letters, digits, `-` and `_`. */
export const containerName = (...parts: readonly string[]): string =>
  parts
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-');

export async function inspectTaskRun(
  docker: DockerExec,
  input: TaskRunInput,
  env: NodeJS.ProcessEnv,
  signal?: AbortSignal,
): Promise<WorkspaceReport> {
  const { task } = input;
  const database =
    input.postgresImage === undefined || !task.services.includes('postgres')
      ? undefined
      : await startDatabase(
          docker,
          { dockerDir: input.dockerDir, project: input.name, postgresImage: input.postgresImage },
          env,
          signal,
        );
  try {
    return await inspectWorkspace(
      docker,
      {
        starterDirs: task.starterDirs,
        hiddenDirs: task.hiddenDirs,
        runDir: input.runDir,
        reportScript: join(input.dockerDir, 'score-report.mjs'),
        name: input.name,
        ...(database === undefined ? {} : { network: database.network }),
      },
      env,
      signal,
    );
  } finally {
    await database?.stop();
  }
}
