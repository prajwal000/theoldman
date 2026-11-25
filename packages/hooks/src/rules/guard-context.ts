// What the command guards need to know beyond the command itself. The hook entry fills it from
// git, the environment and the project; tests use fakes.

export interface GitContext {
  currentBranch(): string | undefined;
  defaultBranch(remote: string): string | undefined;
}

export interface GuardContext extends GitContext {
  /** Directory the command runs in. */
  readonly cwd: string;
  /** Root of the project Claude is working on; deletes must stay strictly inside it. */
  readonly projectRoot: string;
  readonly home: string;
  /** A variable from the environment Claude Code runs in. */
  env(name: string): string | undefined;
  /** A variable from the project's `.env` file. */
  dotenv(name: string): string | undefined;
}

export interface Violation {
  readonly id: 'OLDMAN-G01' | 'OLDMAN-G02' | 'OLDMAN-G03' | 'OLDMAN-G04';
  readonly message: string;
}
