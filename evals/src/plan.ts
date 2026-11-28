// Turns validated arguments, a task and the environment into the planned run, and writes it to
// evals/runs/<timestamp>/plan.json. The plan names the provider's variables but never holds their
// values.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Condition, RunArgs } from './args.ts';
import { AGENT_IMAGE, CLAUDE_CODE_VERSION, IMAGES, imageRefs } from './images.ts';
import { type Models, readModels, requireExactModels } from './models.ts';
import { ConfigError } from './errors.ts';
import {
  detectProvider,
  type Env,
  type Provider,
  type ProviderAuth,
  type ProviderName,
} from './provider.ts';
import { loadTask, starterHash, type Task } from './task.ts';

export interface RunPlan {
  readonly createdAt: string;
  readonly task: {
    readonly id: string;
    readonly title: string;
    readonly timeoutMinutes: number;
    readonly services: readonly string[];
    /** Which starter the run used; scoring rebuilds the run's project from it. */
    readonly starterHash: string;
  };
  readonly condition: Condition;
  readonly runs: number;
  readonly dryRun: boolean;
  readonly publish: boolean;
  readonly provider: {
    readonly name: ProviderName;
    readonly auth: ProviderAuth;
    readonly env: readonly string[];
  };
  readonly models: Models;
  readonly claudeCode: string;
  readonly agentImage: string;
  /** Pull references per base image, Docker Hub first, then its ECR Public mirror. */
  readonly images: Readonly<Record<string, readonly string[]>>;
}

export interface Dirs {
  readonly tasksDir: string;
  readonly runsDir: string;
}

export interface PlannedRun {
  readonly dir: string;
  readonly plan: RunPlan;
  readonly task: Task;
  readonly provider: Provider;
}

export const PLAN_FILE = 'plan.json';

/** The provider and models for a run, refusing a run marked for publication that cannot be. */
export function planProvider(publish: boolean, env: Env): { provider: Provider; models: Models } {
  const provider = detectProvider(env);
  const models = readModels(env);
  if (publish && provider.auth === 'subscription-token') {
    throw new ConfigError(
      'A run marked for publication needs ANTHROPIC_API_KEY: published results come from the Anthropic API (ADR 0007), and CLAUDE_CODE_OAUTH_TOKEN runs on a Claude subscription.',
    );
  }
  if (publish) requireExactModels(provider.name, models);
  return { provider, models };
}

export function planRun(args: RunArgs, env: Env, dirs: Dirs, now: Date = new Date()): PlannedRun {
  const task = loadTask(dirs.tasksDir, args.task);
  const { provider, models } = planProvider(args.publish, env);

  const images: Record<string, string[]> = { node: imageRefs(IMAGES.node) };
  for (const service of task.services) images[service] = imageRefs(IMAGES[service]);

  const plan: RunPlan = {
    createdAt: now.toISOString(),
    task: {
      id: task.id,
      title: task.title,
      timeoutMinutes: task.timeoutMinutes,
      services: task.services,
      starterHash: starterHash(task.starterDirs),
    },
    condition: args.condition,
    runs: args.runs,
    dryRun: args.dryRun,
    publish: args.publish,
    provider: { name: provider.name, auth: provider.auth, env: provider.envNames },
    models,
    claudeCode: CLAUDE_CODE_VERSION,
    agentImage: AGENT_IMAGE,
    images,
  };

  // Colons are not allowed in Windows file names.
  const dir = newRunDir(dirs.runsDir, plan.createdAt.replace(/[:.]/g, '-'));
  writeFileSync(join(dir, PLAN_FILE), `${JSON.stringify(plan, null, 2)}\n`);
  return { dir, plan, task, provider };
}

/** Creates runs/<stamp>/, or runs/<stamp>-2/ and so on when runs start in the same millisecond. */
export function newRunDir(runsDir: string, stamp: string): string {
  mkdirSync(runsDir, { recursive: true });
  for (let n = 1; ; n++) {
    const dir = join(runsDir, n === 1 ? stamp : `${stamp}-${String(n)}`);
    try {
      mkdirSync(dir);
      return dir;
    } catch (error) {
      const exists = error instanceof Error && 'code' in error && error.code === 'EEXIST';
      if (!exists || n >= 100) throw error;
    }
  }
}
