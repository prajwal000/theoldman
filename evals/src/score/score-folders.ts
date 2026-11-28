// Scores run folders into one results file. All folders must have run on the same provider,
// models and Claude Code version, with exact model IDs; each run's project is rebuilt from the
// starter it used, in a container of the scoring image, and scored from what that container
// reports and from the run's run.json and transcript.

import type { Condition } from '../args.ts';
import type { DockerExec } from '../docker.ts';
import { ConfigError } from '../errors.ts';
import { isExactModelId } from '../models.ts';
import type { Env } from '../provider.ts';
import { dockerEnv } from '../secrets.ts';
import { loadTask, starterHash, type Task } from '../task.ts';
import { scoreComments } from './comments.ts';
import { scoreDocs } from './docs.ts';
import { isScorable, runMetrics } from './metrics.ts';
import { aggregate, modelLabel, type Results, type RunValues, type TaskResult } from './results.ts';
import type { FolderPlan, RunFolder } from './run-folder.ts';
import { scoreSecurity } from './security.ts';
import { containerName, inspectTaskRun, prepareScoring } from './task-run.ts';
import { scoreTests } from './tests.ts';

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
  const taskById = new Map<string, Task>();
  for (const { name, plan } of ctx.folders) {
    const task = loadTask(ctx.tasksDir, plan.task.id);
    const hash = starterHash(task.starterDirs);
    if (plan.task.starterHash === null) {
      notes.add(`${name}: the run did not record its starter; scored against the current one.`);
    } else if (plan.task.starterHash !== hash) {
      throw new ConfigError(
        `${name}: the starter of task ${task.id} changed since the run, so its diff cannot be scored against it.`,
      );
    }
    taskById.set(plan.task.id, task);
  }

  const env = dockerEnv(ctx.env);
  const prepared = await prepareScoring(
    ctx.docker,
    { dockerDir: ctx.dockerDir, tasks: [...taskById.values()] },
    env,
    ctx.signal,
    ctx.progress,
  );
  for (const problem of prepared.problems) notes.add(problem);
  const { postgresImage } = prepared;

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
      const task = taskById.get(plan.task.id);
      if (task === undefined) throw new Error(`task ${plan.task.id} was not loaded`);
      const report = await inspectTaskRun(
        ctx.docker,
        {
          task,
          runDir: run.dir,
          name: containerName('theoldman-score', folder.name, run.name),
          dockerDir: ctx.dockerDir,
          postgresImage,
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
      const security = scoreSecurity(run.diff, report.semgrep, report.gitleaks);
      const tests = scoreTests(report.tests);
      for (const note of tests.notes) notes.add(`${plan.task.id}: ${note}`);
      const docs = scoreDocs({
        diff: run.diff,
        files: report.files,
        envExamples: report.envExamples,
        starterDirs: task.starterDirs,
        summary: run.summary,
      });
      const values: RunValues = {
        ...metrics,
        fillerComments: comments.comments,
        addedLines: comments.addedLines,
        docsFindings: docs.findings,
        docsInSync: docs.findings === 0 ? 1 : 0,
      };
      if (comments.addedLines > 0) {
        values.fillerPer100Lines = (comments.comments / comments.addedLines) * 100;
      }
      if (report.tsc !== null) values.tscErrors = report.tsc.errors;
      if (report.eslint !== null) values.eslintErrors = report.eslint.errors;
      if (report.build !== null) values.buildFailed = report.build.ok ? 0 : 1;
      if (security.semgrep !== null) values.semgrepFindings = security.semgrep;
      if (security.gitleaks !== null) values.gitleaksFindings = security.gitleaks;
      if (tests.hiddenPassRate !== null) values.hiddenTestsPassRate = tests.hiddenPassRate;
      if (tests.testsAdded !== null) values.testsAdded = tests.testsAdded;
      group.values.push(values);
      const shown = (value: number | null | undefined): string =>
        value === null || value === undefined ? '-' : String(Math.round(value * 100) / 100);
      ctx.progress?.(
        `${folder.name}/${run.name}: ${String(comments.comments)} filler comments, tsc ${shown(report.tsc?.errors)}, eslint ${shown(report.eslint?.errors)}, build ${report.build === null ? '-' : report.build.ok ? 'ok' : 'failed'}, semgrep ${shown(security.semgrep)}, gitleaks ${shown(security.gitleaks)}, hidden tests ${shown(tests.hiddenPassRate)}, tests added ${shown(tests.testsAdded)}, docs findings ${String(docs.findings)}`,
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
