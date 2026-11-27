// The runner's only way to start a process: the `docker` binary with an argument list, never a
// shell. Claude Code itself only ever runs inside a container, through `docker compose exec`.

import { spawn } from 'node:child_process';
import { ConfigError } from './errors.ts';
import { scrub } from './secrets.ts';

export interface ExecOptions {
  readonly env: NodeJS.ProcessEnv;
  readonly input?: string;
  readonly timeoutMs?: number;
}

export interface ExecResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

export type DockerExec = (args: readonly string[], options: ExecOptions) => Promise<ExecResult>;

export const dockerExec: DockerExec = (args, { env, input, timeoutMs }) =>
  new Promise((resolve, reject) => {
    const child = spawn('docker', [...args], { env, stdio: 'pipe', windowsHide: true });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let timedOut = false;
    const timer =
      timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            child.kill();
          }, timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        code,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        timedOut,
      });
    });
    child.stdin.end(input ?? '');
  });

/** Throws with the end of stderr, scrubbed of secrets, unless the command succeeded. */
export async function must(
  docker: DockerExec,
  args: readonly string[],
  options: ExecOptions,
  secrets: readonly string[],
): Promise<ExecResult> {
  const result = await docker(args, options);
  if (result.code === 0 && !result.timedOut) return result;
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
): Promise<string> {
  const failures: string[] = [];
  for (const ref of refs) {
    const result = await docker(['pull', '-q', ref], { env, timeoutMs: 10 * 60_000 });
    if (result.code === 0 && !result.timedOut) return ref;
    const reason = result.timedOut ? 'timed out' : result.stderr.trim().split('\n').at(-1);
    failures.push(`${ref}: ${reason ?? 'failed'}`);
  }
  throw new ConfigError(`Could not pull any of:\n${failures.join('\n')}`);
}
