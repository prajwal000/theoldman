// Turns validated arguments, a task and the environment into the planned run, and writes it to
// evals/runs/<timestamp>/plan.json. The plan names the provider's variables but never holds their
// values.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Condition, RunArgs } from './args.ts';
import { ConfigError } from './errors.ts';
import { IMAGES, imageRefs } from './images.ts';
import { type Models, readModels, requireExactModels } from './models.ts';
import { detectProvider, type Env, type ProviderName } from './provider.ts';
import { loadTask } from './task.ts';

export interface RunPlan {
  readonly createdAt: string;
  readonly task: {
    readonly id: string;
    readonly title: string;
    readonly timeoutMinutes: number;
    readonly services: readonly string[];
  };
  readonly condition: Condition;
  readonly runs: number;
  readonly dryRun: boolean;
  readonly publish: boolean;
  readonly provider: { readonly name: ProviderName; readonly env: readonly string[] };
  readonly models: Models;
  /** Pull references per image, Docker Hub first, then its ECR Public mirror. */
  readonly images: Readonly<Record<string, readonly string[]>>;
}

export interface Dirs {
  readonly tasksDir: string;
  readonly runsDir: string;
}

export const PLAN_FILE = 'plan.json';

export function planRun(
  args: RunArgs,
  env: Env,
  dirs: Dirs,
  now: Date = new Date(),
): { readonly dir: string; readonly plan: RunPlan } {
  const task = loadTask(dirs.tasksDir, args.task);
  const provider = detectProvider(env);
  const models = readModels(env);
  if (args.publish) requireExactModels(provider.name, models);
  if (!args.dryRun) {
    throw new ConfigError(
      'Only --dry-run is available so far: running tasks in Docker is not built yet.',
    );
  }

  const images: Record<string, string[]> = { node: imageRefs(IMAGES.node) };
  for (const service of task.services) images[service] = imageRefs(IMAGES[service]);

  const plan: RunPlan = {
    createdAt: now.toISOString(),
    task: {
      id: task.id,
      title: task.title,
      timeoutMinutes: task.timeoutMinutes,
      services: task.services,
    },
    condition: args.condition,
    runs: args.runs,
    dryRun: args.dryRun,
    publish: args.publish,
    provider: { name: provider.name, env: provider.envNames },
    models,
    images,
  };

  // Colons are not allowed in Windows file names.
  const dir = join(dirs.runsDir, plan.createdAt.replace(/[:.]/g, '-'));
  mkdirSync(dirs.runsDir, { recursive: true });
  mkdirSync(dir);
  writeFileSync(join(dir, PLAN_FILE), `${JSON.stringify(plan, null, 2)}\n`);
  return { dir, plan };
}
