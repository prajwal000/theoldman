// A fresh Postgres for scoring one run of a task that uses it, from the same compose file and
// pinned image as the runs. Only the postgres service starts; the scoring container joins its
// network, where it answers as `postgres`. It is removed afterwards whatever happens.

import { join } from 'node:path';
import { type DockerExec, must } from '../docker.ts';
import { SCORE_IMAGE } from '../images.ts';

export interface Database {
  /** The Compose project's network, for the scoring container. */
  readonly network: string;
  readonly stop: () => Promise<void>;
}

export interface DatabaseInput {
  readonly dockerDir: string;
  /** Compose project name: lowercase letters, digits, `-` and `_`. */
  readonly project: string;
  /** The pinned Postgres reference that was pulled. */
  readonly postgresImage: string;
}

export async function startDatabase(
  docker: DockerExec,
  input: DatabaseInput,
  env: NodeJS.ProcessEnv,
  signal?: AbortSignal,
): Promise<Database> {
  // Compose interpolates every service, so the agent's image must be named though it never starts.
  const composeEnv = { ...env, AGENT_IMAGE: SCORE_IMAGE, POSTGRES_IMAGE: input.postgresImage };
  const compose = (args: readonly string[]): string[] => [
    'compose',
    '-p',
    input.project,
    '-f',
    join(input.dockerDir, 'compose.yml'),
    '--profile',
    'postgres',
    ...args,
  ];
  const stop = async (): Promise<void> => {
    await docker(compose(['down', '-v', '--remove-orphans', '-t', '0']), {
      env: composeEnv,
      timeoutMs: 2 * 60_000,
    });
  };
  const options = { env: composeEnv, timeoutMs: 5 * 60_000 };
  try {
    await must(
      docker,
      compose(['up', '-d', '--wait', 'postgres']),
      signal === undefined ? options : { ...options, signal },
      [],
    );
  } catch (error) {
    await stop();
    throw error;
  }
  return { network: `${input.project}_default`, stop };
}
