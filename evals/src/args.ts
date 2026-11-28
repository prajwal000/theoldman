import { parseArgs } from 'node:util';
import { ConfigError } from './errors.ts';

export type Condition = 'with' | 'without';

export interface RunArgs {
  readonly task: string;
  readonly condition: Condition;
  readonly runs: number;
  readonly dryRun: boolean;
  readonly publish: boolean;
}

export const DEFAULT_RUNS = 3;
export const MAX_RUNS = 10;

export const USAGE = `Usage: pnpm --filter evals run eval --task <id> --condition with|without [--runs <n>] [--dry-run] [--publish]

  --task       task folder under evals/tasks/
  --condition  with: theoldman loaded; without: no plugin
  --runs       runs per condition, 1 to ${String(MAX_RUNS)} (default ${String(DEFAULT_RUNS)})
  --dry-run    validate everything and write the planned run, without running Claude
  --publish    mark the run for publication: model variables must be exact model IDs`;

// Task IDs become folder names, so they cannot hold path separators or dots.
const TASK_ID = /^[a-z0-9_][a-z0-9_-]*$/;

/** Parses the runner's arguments; `undefined` means `--help` was asked for. */
export function parseRunArgs(argv: readonly string[]): RunArgs | undefined {
  // pnpm forwards a `--` separator when the user types one before the runner's flags.
  const args = argv[0] === '--' ? argv.slice(1) : [...argv];
  let values;
  try {
    ({ values } = parseArgs({
      args,
      strict: true,
      allowPositionals: false,
      options: {
        task: { type: 'string' },
        condition: { type: 'string' },
        runs: { type: 'string' },
        'dry-run': { type: 'boolean', default: false },
        publish: { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
      },
    }));
  } catch (error) {
    throw new ConfigError(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
  }
  if (values.help) return undefined;

  const { task, condition } = values;
  if (task === undefined) throw new ConfigError(`--task is required.\n\n${USAGE}`);
  if (!TASK_ID.test(task)) {
    throw new ConfigError(
      `--task "${task}" is not a task ID: use lowercase letters, digits, "-" and "_".`,
    );
  }
  if (condition !== 'with' && condition !== 'without') {
    throw new ConfigError(`--condition must be "with" or "without".\n\n${USAGE}`);
  }
  return {
    task,
    condition,
    runs: parseRuns(values.runs),
    dryRun: values['dry-run'],
    publish: values.publish,
  };
}

export function parseRuns(text: string | undefined): number {
  if (text === undefined) return DEFAULT_RUNS;
  const runs = /^\d+$/.test(text) ? Number(text) : Number.NaN;
  if (!(runs >= 1 && runs <= MAX_RUNS)) {
    throw new ConfigError(`--runs must be a whole number from 1 to ${String(MAX_RUNS)}.`);
  }
  return runs;
}
