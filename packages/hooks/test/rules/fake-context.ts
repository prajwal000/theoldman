import type { GuardContext } from '../../src/rules/guard-context.js';

export interface FakeOptions {
  readonly current?: string | undefined;
  readonly defaults?: Record<string, string>;
  readonly cwd?: string;
  readonly projectRoot?: string;
  readonly home?: string;
  readonly env?: Record<string, string>;
  readonly dotenv?: Record<string, string>;
}

/** The project the guard fixtures assume: C:\repo on a feature branch, with a remote database. */
export const FIXTURE_OPTIONS: FakeOptions = {
  current: 'feature/x',
  cwd: 'C:\\repo',
  projectRoot: 'C:\\repo',
  home: 'C:\\Users\\me',
  env: { DATABASE_URL: 'postgresql://app@db.internal.example:5432/app' },
};

/** A guard context with fixed answers that records every lookup it is asked for. */
export function fakeContext(options: FakeOptions = {}): { context: GuardContext; calls: string[] } {
  const settings = { ...FIXTURE_OPTIONS, ...options };
  const calls: string[] = [];
  const context: GuardContext = {
    cwd: settings.cwd ?? 'C:\\repo',
    projectRoot: settings.projectRoot ?? 'C:\\repo',
    home: settings.home ?? 'C:\\Users\\me',
    currentBranch: () => {
      calls.push('currentBranch');
      return 'current' in options ? options.current : settings.current;
    },
    defaultBranch: (remote) => {
      calls.push(`defaultBranch ${remote}`);
      return settings.defaults?.[remote] ?? 'main';
    },
    env: (name) => {
      calls.push(`env ${name}`);
      return settings.env?.[name];
    },
    dotenv: (name) => {
      calls.push(`dotenv ${name}`);
      return settings.dotenv?.[name];
    },
  };
  return { context, calls };
}
