// The runner's only way to start a process: the `docker` binary with an argument list, never a
// shell. Claude Code itself only ever runs inside a container, through `docker compose exec`.

import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { join } from 'node:path';
import { ConfigError } from './errors.ts';
import { AGENT_IMAGE, CLAUDE_CODE_VERSION, IMAGES, imageRefs, NPM_VERSION } from './images.ts';
import { scrub } from './secrets.ts';

export interface ExecOptions {
  readonly env: NodeJS.ProcessEnv;
  readonly input?: string;
  readonly timeoutMs?: number;
  /** Stops the command when aborted, as on Ctrl+C; it then ends with code null. */
  readonly signal?: AbortSignal;
}

/** Thrown when a step is skipped or stopped because the run was interrupted. */
export class InterruptedError extends Error {
  override readonly name = 'InterruptedError';
  constructor() {
    super('interrupted');
  }
}

export interface ExecResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

export type DockerExec = (args: readonly string[], options: ExecOptions) => Promise<ExecResult>;

export const dockerExec: DockerExec = (args, options) => {
  if (options.signal?.aborted === true) {
    return Promise.resolve({ code: null, stdout: '', stderr: '', timedOut: false });
  }
  const { env } = options;
  return collect(spawn('docker', [...args], { env, stdio: 'pipe', windowsHide: true }), options);
};

/** Feeds a started process its input and gathers its output, stopping it on timeout or abort. */
export function collect(
  child: ChildProcessWithoutNullStreams,
  { input, timeoutMs, signal }: Omit<ExecOptions, 'env'>,
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let timedOut = false;
    let killed = false;
    let settled = false;
    const kill = (): void => {
      killed = true;
      child.kill();
    };
    const timer =
      timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            kill();
          }, timeoutMs);
    signal?.addEventListener('abort', kill, { once: true });
    const finish = (code: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', kill);
      child.stdout.destroy();
      child.stderr.destroy();
      resolve({
        code,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        timedOut,
      });
    };
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', kill);
      reject(error);
    });
    // `docker compose` runs as a child of `docker`, and on Windows it outlives a killed `docker`
    // and keeps the pipes open until the command in the container ends. So after a kill the
    // result is taken at exit, not when the pipes close; removing the container ends the rest.
    child.on('exit', (code) => {
      if (killed) finish(code);
    });
    child.on('close', finish);
    child.stdin.end(input ?? '');
  });
}

/** Throws with the end of stderr, scrubbed of secrets, unless the command succeeded. */
export async function must(
  docker: DockerExec,
  args: readonly string[],
  options: ExecOptions,
  secrets: readonly string[],
): Promise<ExecResult> {
  const result = await docker(args, options);
  if (result.code === 0 && !result.timedOut) return result;
  if (options.signal?.aborted === true) throw new InterruptedError();
  const tail = scrub(result.stderr.trim(), secrets).split('\n').slice(-5).join('\n');
  const why = result.timedOut ? 'timed out' : `exited with ${String(result.code)}`;
  throw new Error(`docker ${args.slice(0, 3).join(' ')} ${why}${tail === '' ? '' : `:\n${tail}`}`);
}

/** Refuses to go on unless a Docker engine with Linux containers answers. */
export async function requireDocker(docker: DockerExec, env: NodeJS.ProcessEnv): Promise<void> {
  let result: ExecResult;
  try {
    result = await docker(['version', '--format', '{{.Server.Os}}'], { env, timeoutMs: 30_000 });
  } catch {
    throw new ConfigError(
      'Docker is not installed or not on PATH. Eval runs happen only in Docker.',
    );
  }
  if (result.code !== 0) {
    throw new ConfigError('Docker is not running. Start Docker; eval runs happen only in Docker.');
  }
  if (result.stdout.trim() !== 'linux') {
    throw new ConfigError(
      `Docker runs ${result.stdout.trim()} containers; the eval image needs Linux containers.`,
    );
  }
}

/** Pulls the first reference that works, Docker Hub before its mirror, and returns it. */
export async function pullFirst(
  docker: DockerExec,
  refs: readonly string[],
  env: NodeJS.ProcessEnv,
  signal?: AbortSignal,
): Promise<string> {
  const failures: string[] = [];
  for (const ref of refs) {
    const options = signal === undefined ? { env } : { env, signal };
    const result = await docker(['pull', '-q', ref], { ...options, timeoutMs: 10 * 60_000 });
    if (result.code === 0 && !result.timedOut) return ref;
    if (signal?.aborted === true) throw new InterruptedError();
    const reason = result.timedOut ? 'timed out' : result.stderr.trim().split('\n').at(-1);
    failures.push(`${ref}: ${reason ?? 'failed'}`);
  }
  throw new ConfigError(`Could not pull any of:\n${failures.join('\n')}`);
}

/**
 * Builds the agent image (evals/docker/Dockerfile) on the pinned node image and returns the node
 * reference it was built on. Runs and scoring both use it.
 */
export async function buildAgentImage(
  docker: DockerExec,
  dockerDir: string,
  env: NodeJS.ProcessEnv,
  secrets: readonly string[],
  signal?: AbortSignal,
): Promise<string> {
  const node = await pullFirst(docker, imageRefs(IMAGES.node), env, signal);
  const args = [
    'build',
    '-q',
    '-f',
    join(dockerDir, 'Dockerfile'),
    '--build-arg',
    `NODE_IMAGE=${node}`,
    '--build-arg',
    `CLAUDE_CODE_VERSION=${CLAUDE_CODE_VERSION}`,
    '--build-arg',
    `NPM_VERSION=${NPM_VERSION}`,
    '-t',
    AGENT_IMAGE,
    dockerDir,
  ];
  const options = { env, timeoutMs: 20 * 60_000 };
  await must(docker, args, signal === undefined ? options : { ...options, signal }, secrets);
  return node;
}
