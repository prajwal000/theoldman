// Scores run folders into one results file. All folders must have run on the same provider,
// models and Claude Code version, with exact model IDs; each run's project is rebuilt from the
// starter it used, in a container, and scored there and from its run.json.

import { join } from 'node:path';
import type { Condition } from '../args.ts';
import { buildAgentImage, type DockerExec, requireDocker } from '../docker.ts';
import { ConfigError } from '../errors.ts';
import { isExactModelId } from '../models.ts';
import type { Env } from '../provider.ts';
import { dockerEnv } from '../secrets.ts';
import { folderHash, loadTask } from '../task.ts';
import { scoreComments } from './comments.ts';
import { isScorable, runMetrics } from './metrics.ts';
import { aggregate, modelLabel, type Results, type RunValues, type TaskResult } from './results.ts';
import type { FolderPlan, RunFolder } from './run-folder.ts';
import { inspectWorkspace } from './workspace.ts';

export interface ScoreContext {
  readonly folders: readonly RunFolder[];
  readonly tasksDir: string;
  readonly dockerDir: string;
  readonly env: Env;
  readonly docker: DockerExec;
  readonly signal?: AbortSignal;
  readonly now?: Date;
  /** Called with one line per scored run, for progress output. */
  readonly progress?: (line: string) => void;
}

interface Group {
  readonly title: string;
  readonly values: RunValues[];
  failed: number;
  readonly folders: Set<string>;
}

function sameRun(plans: readonly FolderPlan[]) {
  const [first] = plans;
  if (first === undefined) throw new ConfigError('Name at least one run folder to score.');
  const key = (plan: FolderPlan): string =>
    JSON.stringify([plan.provider, plan.models, plan.claudeCode]);
  if (plans.some((plan) => key(plan) !== key(first))) {
    throw new ConfigError(
      'The run folders ran on different providers, models or Claude Code versions; score them separately.',
    );
  }
  const exact = (name: string, value: string | null): string => {
    if (value !== null && isExactModelId(first.provider.name, value)) return value;
    throw new ConfigError(
      `Results need runs with exact model IDs, but ${name} was ${value === null ? 'not set' : `"${value}"`}. Re-run with it pinned, such as claude-sonnet-5-5.`,
    );
  };
  return {
    first,
    main: exact('ANTHROPIC_MODEL', first.models.ANTHROPIC_MODEL),
    sonnet: exact('ANTHROPIC_DEFAULT_SONNET_MODEL', first.models.ANTHROPIC_DEFAULT_SONNET_MODEL),
  };
}

export async function scoreFolders(ctx: ScoreContext): Promise<Results> {
  const { first, main, sonnet } = sameRun(ctx.folders.map((folder) => folder.plan));
  const notes = new Set<string>();
  const starters = new Map<string, string>();
  for (const { name, plan } of ctx.folders) {
    const task = loadTask(ctx.tasksDir, plan.task.id);
    const hash = folderHash(task.starterDir);
    if (plan.task.starterHash === null) {
      notes.add(`${name}: the run did not record its starter; scored against the current one.`);
    } else if (plan.task.starterHash !== hash) {
      throw new ConfigError(
        `${name}: the starter of task ${task.id} changed since the run, so its diff cannot be scored against it.`,
      );
    }
    starters.set(plan.task.id, task.starterDir);
  }

  const env = dockerEnv(ctx.env);
  await requireDocker(ctx.docker, env);
  await buildAgentImage(ctx.docker, ctx.dockerDir, env, [], ctx.signal);

  const groups = new Map<string, Map<Condition, Group>>();
  const used = new Set<string>();
  for (const folder of ctx.folders) {
    const { plan } = folder;
    const byCondition = groups.get(plan.task.id) ?? new Map<Condition, Group>();
    groups.set(plan.task.id, byCondition);
    const group = byCondition.get(plan.condition) ?? {
      title: plan.task.title,
      values: [],
      failed: 0,
      folders: new Set<string>(),
    };
    byCondition.set(plan.condition, group);
    group.folders.add(folder.name);

    for (const run of folder.runs) {
      const metrics = runMetrics(run.record);
      if (!isScorable(run.record) || metrics === null || run.diff === null) {
        group.failed += 1;
        ctx.progress?.(
          `${folder.name}/${run.name}: not scored (${run.record.error ?? 'no result'})`,
        );
        continue;
      }
      const starterDir = starters.get(plan.task.id);
      if (starterDir === undefined) throw new Error(`no starter loaded for ${plan.task.id}`);
      const report = await inspectWorkspace(
        ctx.docker,
        {
          starterDir,
          runDir: run.dir,
          reportScript: join(ctx.dockerDir, 'score-report.mjs'),
          name: `theoldman-score-${folder.name}-${run.name}`
            .toLowerCase()
            .replace(/[^a-z0-9_.-]/g, '-'),
        },
        env,
        ctx.signal,
      );
      for (const note of report.notes) notes.add(`${plan.task.id}: ${note}`);
      if (report.error !== null) {
        group.failed += 1;
        notes.add(`${folder.name}/${run.name}: ${report.error}`);
        continue;
      }
      for (const model of Object.keys(run.record.result?.modelUsage ?? {})) used.add(model);
      const comments = scoreComments(run.diff, report.files);
      const values: RunValues = {
        ...metrics,
        fillerComments: comments.comments,
        addedLines: comments.addedLines,
      };
      if (comments.addedLines > 0) {
        values.fillerPer100Lines = (comments.comments / comments.addedLines) * 100;
      }
      if (report.tsc !== null) values.tscErrors = report.tsc.errors;
      if (report.eslint !== null) values.eslintErrors = report.eslint.errors;
      group.values.push(values);
      ctx.progress?.(
        `${folder.name}/${run.name}: ${String(comments.comments)} filler comments, tsc ${String(report.tsc?.errors ?? '-')}, eslint ${String(report.eslint?.errors ?? '-')}`,
      );
    }
  }

  const tasks: TaskResult[] = [...groups].map(([id, byCondition]) => {
    const conditions: TaskResult['conditions'] = {};
    let title = id;
    for (const [condition, group] of byCondition) {
      title = group.title;
      conditions[condition] = aggregate(group.values, group.failed, [...group.folders].sort());
    }
    return { id, title, conditions };
  });

  if (used.size === 0)
    throw new ConfigError('No run in these folders finished, so there is nothing to score.');
  const newest =
    ctx.folders
      .map((folder) => folder.plan.createdAt)
      .sort()
      .at(-1) ?? '';
  return {
    schemaVersion: 1,
    createdAt: (ctx.now ?? new Date()).toISOString(),
    date: newest.slice(0, 10),
    label: modelLabel(main),
    published: ctx.folders.every(
      (folder) => folder.plan.publish && folder.plan.provider.auth === 'api-key',
    ),
    provider: first.provider,
    models: {
      ANTHROPIC_MODEL: main,
      ANTHROPIC_DEFAULT_SONNET_MODEL: sonnet,
      used: [...used].sort(),
    },
    claudeCode: first.claudeCode,
    notes: [...notes].sort(),
    tasks,
  };
}
