// Rebuilds the project a run ended with, in a fresh container of the scoring image, and reads
// back what the scorers need (evals/docker/score-report.mjs): changed files, tsc and ESLint
// counts, Semgrep and gitleaks findings, and vitest counts with the hidden tests. The container
// gets no credentials and only read-only mounts, and Claude's code never runs on the host.

import { type DockerExec, InterruptedError } from '../docker.ts';
import { ConfigError } from '../errors.ts';
import { DATABASE_URL } from '../execute.ts';
import { SCORE_IMAGE } from '../images.ts';
import { OWNER_LABEL } from '../orphans.ts';
import { npmCacheMount } from './npm-cache.ts';

/** A Semgrep or gitleaks finding: the rule and where, never the matched text. */
export interface ToolFinding {
  readonly rule: string;
  readonly path: string;
  readonly line: number;
  /** Last line of a multi-line Semgrep match; gitleaks findings are one line. */
  readonly endLine: number;
}

export interface TestCounts {
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  /** False when the file failed to load, so vitest could not count its tests. */
  readonly loaded: boolean;
}

/** vitest counts by test file path, or null when vitest could not run. */
export type TestFiles = Readonly<Record<string, TestCounts>> | null;

export interface WorkspaceReport {
  /** Final text of each changed text file, by path. */
  readonly files: Readonly<Record<string, string>>;
  /** Final text of every .env.example in the project, changed or not. */
  readonly envExamples: Readonly<Record<string, string>>;
  /** Null when the project has no tsconfig.json or no TypeScript installed. */
  readonly tsc: { readonly errors: number } | null;
  /** Null when the project has no ESLint config or no ESLint installed. */
  readonly eslint: { readonly errors: number; readonly warnings: number } | null;
  /** Whether `next build` passed; null for a project without Next.js installed. */
  readonly build: { readonly ok: boolean } | null;
  /** Findings in the changed files; null when Semgrep failed. */
  readonly semgrep: readonly ToolFinding[] | null;
  /** Findings in the run's changes; null when gitleaks failed. */
  readonly gitleaks: readonly ToolFinding[] | null;
  readonly tests: {
    /** Paths of the hidden test files, as copied into the project. */
    readonly hidden: readonly string[];
    /** The untouched starter with the hidden tests copied in. */
    readonly starter: TestFiles;
    /** The finished project with the hidden tests copied in. */
    readonly final: TestFiles;
  };
  readonly notes: readonly string[];
  /** Set when the run's diff does not apply to the starter. */
  readonly error: string | null;
}

export interface WorkspaceInput {
  /** The task's starter folders, copied in this order. */
  readonly starterDirs: readonly string[];
  /** Hidden test folders, copied in this order: shared helpers, then the task's tests. */
  readonly hiddenDirs: readonly string[];
  /** For a task with Postgres: the Docker network where it answers as `postgres`. */
  readonly network?: string;
  readonly runDir: string;
  readonly reportScript: string;
  /** Container name, so an interrupted scoring run can remove it. */
  readonly name: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;
const isLine = (value: unknown): value is number => isCount(value) && value >= 1;

function mount(source: string, target: string): string[] {
  // --mount separates its fields with commas, so a path with one would be misread.
  if (source.includes(',')) throw new ConfigError(`Cannot mount a path with a comma: ${source}`);
  return ['--mount', `type=bind,source=${source},target=${target},readonly`];
}

export function workspaceArgs(input: WorkspaceInput): string[] {
  const database =
    input.network === undefined
      ? []
      : ['--network', input.network, '-e', `DATABASE_URL=${DATABASE_URL}`];
  return [
    'run',
    '--rm',
    '--name',
    input.name,
    '--label',
    `${OWNER_LABEL}=${String(process.pid)}`,
    ...database,
    // Prisma's CLI reports usage to Prisma unless told not to.
    '-e',
    'CHECKPOINT_DISABLE=1',
    ...input.starterDirs.flatMap((dir, index) => mount(dir, `/starters/${String(index)}`)),
    ...input.hiddenDirs.flatMap((dir, index) => mount(dir, `/hidden/${String(index)}`)),
    ...npmCacheMount(),
    ...mount(input.runDir, '/run'),
    ...mount(input.reportScript, '/score/report.mjs'),
    '--entrypoint',
    'node',
    SCORE_IMAGE,
    '/score/report.mjs',
  ];
}

export async function inspectWorkspace(
  docker: DockerExec,
  input: WorkspaceInput,
  env: NodeJS.ProcessEnv,
  signal?: AbortSignal,
): Promise<WorkspaceReport> {
  const options = { env, timeoutMs: 30 * 60_000 };
  const result = await docker(
    workspaceArgs(input),
    signal === undefined ? options : { ...options, signal },
  );
  if (signal?.aborted === true || result.timedOut) {
    // A killed `docker run` client leaves its container running.
    await docker(['rm', '-f', input.name], { env, timeoutMs: 60_000 });
    if (signal?.aborted === true) throw new InterruptedError();
    throw new Error('the scoring container timed out after 30 minutes');
  }
  if (result.code !== 0) {
    const tail = result.stderr.trim().split('\n').slice(-3).join('\n');
    throw new Error(`the scoring container exited with ${String(result.code)}: ${tail}`);
  }
  return parseReport(result.stdout);
}

/** Reads the report script's JSON line, rejecting anything that does not have its shape. */
export function parseReport(stdout: string): WorkspaceReport {
  const line = stdout.trim().split('\n').at(-1) ?? '';
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new Error('the scoring container printed no report');
  }
  if (!isRecord(value)) throw new Error('the scoring report is not an object');
  const notes = Array.isArray(value.notes)
    ? value.notes.filter((note): note is string => typeof note === 'string')
    : [];
  if (typeof value.error === 'string') {
    return {
      files: {},
      envExamples: {},
      tsc: null,
      eslint: null,
      build: null,
      semgrep: null,
      gitleaks: null,
      tests: { hidden: [], starter: null, final: null },
      notes,
      error: value.error,
    };
  }

  return {
    files: readTexts(value.files, 'files'),
    envExamples: readTexts(value.envExamples, 'envExamples'),
    tsc: readTsc(value.tsc),
    eslint: readEslint(value.eslint),
    build: readBuild(value.build),
    semgrep: readFindings(value.semgrep, 'Semgrep'),
    gitleaks: readFindings(value.gitleaks, 'gitleaks'),
    tests: readTests(value.tests),
    notes,
    error: null,
  };
}

function readTexts(value: unknown, field: string): Record<string, string> {
  if (!isRecord(value)) throw new Error(`the scoring report has no ${field}`);
  const texts: Record<string, string> = {};
  for (const [path, text] of Object.entries(value)) {
    if (typeof text !== 'string') throw new Error(`the scoring report's ${path} is not text`);
    texts[path] = text;
  }
  return texts;
}

function readTsc(value: unknown): WorkspaceReport['tsc'] {
  if (value === null) return null;
  if (isRecord(value) && isCount(value.errors)) return { errors: value.errors };
  throw new Error('the scoring report has a malformed tsc count');
}

function readEslint(value: unknown): WorkspaceReport['eslint'] {
  if (value === null) return null;
  if (isRecord(value) && isCount(value.errors) && isCount(value.warnings)) {
    return { errors: value.errors, warnings: value.warnings };
  }
  throw new Error('the scoring report has malformed ESLint counts');
}

function readBuild(value: unknown): WorkspaceReport['build'] {
  // Reports from before the build step have no field at all.
  if (value === null || value === undefined) return null;
  if (isRecord(value) && typeof value.ok === 'boolean') return { ok: value.ok };
  throw new Error('the scoring report has a malformed build result');
}

function readFindings(value: unknown, tool: string): ToolFinding[] | null {
  if (value === null) return null;
  const malformed = new Error(`the scoring report has malformed ${tool} findings`);
  if (!isRecord(value) || !Array.isArray(value.findings)) throw malformed;
  return value.findings.map((finding: unknown) => {
    if (!isRecord(finding)) throw malformed;
    const { rule, path, line, endLine = line } = finding;
    if (typeof rule !== 'string' || typeof path !== 'string' || !isLine(line) || !isLine(endLine)) {
      throw malformed;
    }
    return { rule, path, line, endLine };
  });
}

function readTestFiles(value: unknown): TestFiles {
  if (value === null) return null;
  const malformed = new Error('the scoring report has malformed test counts');
  if (!isRecord(value)) throw malformed;
  const files: Record<string, TestCounts> = {};
  for (const [path, counts] of Object.entries(value)) {
    if (!isRecord(counts)) throw malformed;
    const { passed, failed, skipped, loaded } = counts;
    if (!isCount(passed) || !isCount(failed) || !isCount(skipped) || typeof loaded !== 'boolean') {
      throw malformed;
    }
    files[path] = { passed, failed, skipped, loaded };
  }
  return files;
}

function readTests(value: unknown): WorkspaceReport['tests'] {
  if (!isRecord(value) || !Array.isArray(value.hidden)) {
    throw new Error('the scoring report has no test results');
  }
  const hidden = value.hidden.filter((path): path is string => typeof path === 'string');
  return { hidden, starter: readTestFiles(value.starter), final: readTestFiles(value.final) };
}
