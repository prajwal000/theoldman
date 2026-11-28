// Moves reference patches onto a changed starter. A reference.patch is a diff against the starter
// as it was; once the shared starter changes (its README, say), the patch may no longer apply.
// The merge runs in a container (evals/docker/refresh-patch.mjs) with the repository mounted
// read-only, because docker is the only process the runner starts; this module only reads its
// answer and writes the new patch.

import { existsSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { DockerExec } from './docker.ts';
import { ConfigError } from './errors.ts';
import { AGENT_IMAGE } from './images.ts';
import { OWNER_LABEL } from './orphans.ts';
import type { Task } from './task.ts';

export type Refresh = 'unchanged' | 'updated' | 'conflict' | 'no-reference';

export interface RefreshInput {
  readonly task: Task;
  readonly repoRoot: string;
  /** The git ref where the patches last applied. */
  readonly fromRef: string;
  readonly dockerDir: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function mount(source: string, target: string): string[] {
  // --mount separates its fields with commas, so a path with one would be misread.
  if (source.includes(',')) throw new ConfigError(`Cannot mount a path with a comma: ${source}`);
  return ['--mount', `type=bind,source=${source},target=${target},readonly`];
}

const inRepo = (repoRoot: string, path: string): string =>
  relative(repoRoot, path).split(sep).join('/');

export function refreshArgs(input: RefreshInput): string[] {
  const { task, repoRoot, fromRef } = input;
  const config = {
    repo: '/repo',
    ref: fromRef,
    starterDirs: task.starterDirs.map((dir) => inRepo(repoRoot, dir)),
    patch: inRepo(repoRoot, join(task.dir, 'reference.patch')),
  };
  return [
    'run',
    '--rm',
    '--label',
    `${OWNER_LABEL}=${String(process.pid)}`,
    '--network',
    'none',
    ...mount(repoRoot, '/repo'),
    ...mount(join(input.dockerDir, 'refresh-patch.mjs'), '/refresh/patch.mjs'),
    '--entrypoint',
    'node',
    AGENT_IMAGE,
    '/refresh/patch.mjs',
    JSON.stringify(config),
  ];
}

/** Rewrites the task's reference.patch so it applies to the starter as it is now. */
export async function refreshPatch(
  docker: DockerExec,
  input: RefreshInput,
  env: NodeJS.ProcessEnv,
): Promise<Refresh> {
  const patchFile = join(input.task.dir, 'reference.patch');
  if (!existsSync(patchFile)) return 'no-reference';
  const result = await docker(refreshArgs(input), { env, timeoutMs: 5 * 60_000 });
  if (result.code !== 0) {
    const tail = result.stderr.trim().split('\n').slice(-3).join('\n');
    throw new Error(`refreshing ${input.task.id} failed: ${tail}`);
  }
  let answer: unknown;
  try {
    answer = JSON.parse(result.stdout.trim().split('\n').at(-1) ?? '');
  } catch {
    throw new Error(`refreshing ${input.task.id} printed no answer`);
  }
  if (!isRecord(answer)) throw new Error(`refreshing ${input.task.id} gave a malformed answer`);
  const { outcome, patch } = answer;
  if (outcome === 'updated' && typeof patch === 'string') {
    writeFileSync(patchFile, patch);
    return 'updated';
  }
  if (outcome === 'unchanged' || outcome === 'conflict') return outcome;
  throw new Error(`refreshing ${input.task.id} gave a malformed answer`);
}
