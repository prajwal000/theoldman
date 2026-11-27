// Rebuilds the project a run ended with, in a fresh container, and reads back its changed files
// and its tsc and ESLint counts (evals/docker/score-report.mjs). The container gets no
// credentials and only read-only mounts, and Claude's code never runs on the host.

import { type DockerExec, InterruptedError } from '../docker.ts';
import { ConfigError } from '../errors.ts';
import { AGENT_IMAGE } from '../images.ts';

export interface WorkspaceReport {
  /** Final text of each changed text file, by path. */
  readonly files: Readonly<Record<string, string>>;
  /** Null when the project has no tsconfig.json or no TypeScript installed. */
  readonly tsc: { readonly errors: number } | null;
  /** Null when the project has no ESLint config or no ESLint installed. */
  readonly eslint: { readonly errors: number; readonly warnings: number } | null;
  readonly notes: readonly string[];
  /** Set when the run's diff does not apply to the starter. */
  readonly error: string | null;
}

export interface WorkspaceInput {
  readonly starterDir: string;
  readonly runDir: string;
  readonly reportScript: string;
  /** Container name, so an interrupted scoring run can remove it. */
  readonly name: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

function mount(source: string, target: string): string[] {
  // --mount separates its fields with commas, so a path with one would be misread.
  if (source.includes(',')) throw new ConfigError(`Cannot mount a path with a comma: ${source}`);
  return ['--mount', `type=bind,source=${source},target=${target},readonly`];
}

export function workspaceArgs(input: WorkspaceInput): string[] {
  return [
    'run',
    '--rm',
    '--name',
    input.name,
    ...mount(input.starterDir, '/starter'),
    ...mount(input.runDir, '/run'),
    ...mount(input.reportScript, '/score/report.mjs'),
    '--entrypoint',
    'node',
    AGENT_IMAGE,
    '/score/report.mjs',
  ];
}

export async function inspectWorkspace(
  docker: DockerExec,
  input: WorkspaceInput,
  env: NodeJS.ProcessEnv,
  signal?: AbortSignal,
): Promise<WorkspaceReport> {
  const options = { env, timeoutMs: 20 * 60_000 };
  const result = await docker(
    workspaceArgs(input),
    signal === undefined ? options : { ...options, signal },
  );
  if (signal?.aborted === true || result.timedOut) {
    // A killed `docker run` client leaves its container running.
    await docker(['rm', '-f', input.name], { env, timeoutMs: 60_000 });
    if (signal?.aborted === true) throw new InterruptedError();
    throw new Error('the scoring container timed out after 20 minutes');
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
    return { files: {}, tsc: null, eslint: null, notes, error: value.error };
  }

  const { files } = value;
  if (!isRecord(files)) throw new Error('the scoring report has no files');
  const texts: Record<string, string> = {};
  for (const [path, text] of Object.entries(files)) {
    if (typeof text !== 'string') throw new Error(`the scoring report's ${path} is not text`);
    texts[path] = text;
  }
  return {
    files: texts,
    tsc: readTsc(value.tsc),
    eslint: readEslint(value.eslint),
    notes,
    error: null,
  };
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
