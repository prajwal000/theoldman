import type { GuardContext } from '../../src/rules/guard-context.js';

export interface FakeOptions {
  readonly current?: string | undefined;
  readonly defaults?: Record<string, string>;
  readonly cwd?: string;
  readonly projectRoot?: string;
  readonly home?: string;
  readonly env?: Record<string, string>;
  readonly dotenv?: Record<string, string>;
  /** Scripts of the package.json at the project root. */
  readonly scripts?: Record<string, string>;
}

/** The project the guard fixtures assume: C:\repo on a feature branch, with a remote database. */
export const FIXTURE_OPTIONS: FakeOptions = {
  current: 'feature/x',
  cwd: 'C:\\repo',
  projectRoot: 'C:\\repo',
  home: 'C:\\Users\\me',
  env: { DATABASE_URL: 'postgresql://app@db.internal.example:5432/app' },
  scripts: {
    build: 'tsc -p .',
    test: 'vitest run',
    clean: 'rm -rf dist coverage',
    nuke: 'rm -rf ../shared',
    ship: 'git push -f origin main',
    predeploy: 'git push --force origin main',
    deploy: 'echo deploying',
    'db:reset': 'prisma migrate reset --force',
    'db:reset:local': 'DATABASE_URL=postgresql://localhost/app prisma migrate reset --force',
    reset: 'npm run db:reset',
    chain1: 'npm run chain2',
    chain2: 'pnpm run chain3',
    chain3: 'yarn db:reset',
    self: 'npm run self',
  },
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
    packageScripts: (dir) => {
      calls.push(`packageScripts ${dir}`);
      const root = settings.projectRoot ?? 'C:\\repo';
      return settings.scripts === undefined
        ? undefined
        : { dir: root, scripts: new Map(Object.entries(settings.scripts)) };
    },
  };
  return { context, calls };
}
