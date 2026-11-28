// Checks that each task still works: its untouched starter fails every hidden test, and its
// reference.patch passes every one, with no tsc, ESLint, build, Semgrep, gitleaks, filler-comment
// or docs findings. Both are scored exactly like a run (task-run.ts), so a change to the starter,
// the hidden tests or scoring itself that breaks a task shows up here before it skews results.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DockerExec } from '../docker.ts';
import type { Env } from '../provider.ts';
import { dockerEnv } from '../secrets.ts';
import type { Task } from '../task.ts';
import { scoreComments } from './comments.ts';
import { scoreDocs } from './docs.ts';
import { scoreSecurity } from './security.ts';
import { containerName, inspectTaskRun, prepareScoring } from './task-run.ts';
import { scoreTests } from './tests.ts';
import type { WorkspaceReport } from './workspace.ts';

export type Kind = 'starter' | 'reference';

export interface Verdict {
  readonly task: string;
  readonly kind: Kind;
  readonly hiddenPassRate: number | null;
  readonly problems: readonly string[];
}

export interface VerifyContext {
  readonly tasks: readonly Task[];
  readonly dockerDir: string;
  readonly env: Env;
  readonly docker: DockerExec;
  /** Where the run folders for the starter and reference go; nothing secret is written. */
  readonly workDir: string;
  readonly signal?: AbortSignal;
  readonly progress?: (line: string) => void;
}

const rate = (value: number | null): string =>
  value === null ? 'none' : String(Math.round(value * 1000) / 1000);

/** What is wrong with one scored starter or reference; no problems means it is as it should be. */
export function judge(
  task: Task,
  kind: Kind,
  diff: string,
  report: WorkspaceReport,
  summary = '',
): Verdict {
  const verdict = (hiddenPassRate: number | null, problems: string[]): Verdict => ({
    task: task.id,
    kind,
    hiddenPassRate,
    problems,
  });
  if (report.error !== null) return verdict(null, [report.error]);

  const problems = report.notes.filter((note) => /failed|did not/.test(note));
  const tests = scoreTests(report.tests);
  problems.push(...tests.notes);
  if (kind === 'starter') {
    if (tests.hiddenPassRate !== 0) {
      problems.push(
        `every hidden test should fail on the starter, but the pass rate is ${rate(tests.hiddenPassRate)}`,
      );
    }
    return verdict(tests.hiddenPassRate, problems);
  }

  if (tests.hiddenPassRate !== 1) {
    problems.push(
      `every hidden test should pass with the reference, but the pass rate is ${rate(tests.hiddenPassRate)}`,
    );
  }
  if (report.tsc === null || report.tsc.errors > 0) {
    problems.push(
      `tsc: ${report.tsc === null ? 'did not run' : `${String(report.tsc.errors)} errors`}`,
    );
  }
  if (report.eslint === null || report.eslint.errors > 0) {
    problems.push(
      `ESLint: ${report.eslint === null ? 'did not run' : `${String(report.eslint.errors)} errors`}`,
    );
  }
  if (report.build !== null && !report.build.ok) problems.push('next build failed');
  const security = scoreSecurity(diff, report.semgrep, report.gitleaks);
  if (security.semgrep !== 0 || security.gitleaks !== 0) {
    const counts = `Semgrep ${String(security.semgrep ?? 'did not run')}, gitleaks ${String(security.gitleaks ?? 'did not run')}`;
    problems.push(`security findings: ${counts} (${Object.keys(security.byRule).join(', ')})`);
  }
  const comments = scoreComments(diff, report.files);
  if (comments.comments > 0) {
    problems.push(
      `${String(comments.comments)} filler comments (${Object.keys(comments.byRule).join(', ')})`,
    );
  }
  const docs = scoreDocs({
    diff,
    files: report.files,
    envExamples: report.envExamples,
    starterDirs: task.starterDirs,
    summary,
  });
  if (docs.findings > 0) problems.push(`docs findings: ${Object.keys(docs.byRule).join(', ')}`);
  return verdict(tests.hiddenPassRate, problems);
}

export async function verifyTasks(ctx: VerifyContext): Promise<Verdict[]> {
  const env = dockerEnv(ctx.env);
  const prepared = await prepareScoring(
    ctx.docker,
    { dockerDir: ctx.dockerDir, tasks: ctx.tasks },
    env,
    ctx.signal,
    ctx.progress,
  );
  for (const problem of prepared.problems) ctx.progress?.(`note: ${problem}`);

  const verdicts: Verdict[] = [];
  for (const task of ctx.tasks) {
    const patch = join(task.dir, 'reference.patch');
    const reference = existsSync(patch) ? readFileSync(patch, 'utf8') : null;
    if (reference === null) {
      verdicts.push({
        task: task.id,
        kind: 'reference',
        hiddenPassRate: null,
        problems: ['the task has no reference.patch'],
      });
    }
    // reference.md, when present, is what the reference's author would say in a run's final
    // message, such as why it adds a dependency (OLDMAN-D03 looks for that).
    const summaryFile = join(task.dir, 'reference.md');
    const summary = existsSync(summaryFile) ? readFileSync(summaryFile, 'utf8') : '';

    const kinds: [Kind, string][] = [['starter', '']];
    if (reference !== null) kinds.push(['reference', reference]);
    for (const [kind, diff] of kinds) {
      const runDir = join(ctx.workDir, `${task.id}-${kind}`);
      mkdirSync(runDir, { recursive: true });
      writeFileSync(join(runDir, 'diff.patch'), diff);
      const report = await inspectTaskRun(
        ctx.docker,
        {
          task,
          runDir,
          name: containerName('theoldman-verify', task.id, kind),
          dockerDir: ctx.dockerDir,
          postgresImage: prepared.postgresImage,
        },
        env,
        ctx.signal,
      );
      const verdict = judge(task, kind, diff, report, kind === 'reference' ? summary : '');
      verdicts.push(verdict);
      const outcome = verdict.problems.length === 0 ? 'ok' : verdict.problems.join('; ');
      ctx.progress?.(
        `${task.id} ${kind}: hidden tests ${rate(verdict.hiddenPassRate)}, ${outcome}`,
      );
    }
  }
  return verdicts;
}
