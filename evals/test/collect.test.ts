import { spawn } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { collect, dockerExec } from '../src/docker.ts';

// The shape of `docker` running `docker compose`: a parent whose child shares its output pipes
// and outlives it. The parent prints the child's pid, then both wait. On Linux and macOS this
// child keeps the pipes open, so without the fix `collect` waits out its whole life; on Windows
// Node's child does not hold them the way `docker compose` does, and the tests pass either way.
const PARENT = `
const { spawn } = require('node:child_process');
const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], {
  stdio: ['ignore', 'inherit', 'inherit'],
});
process.stdout.write(String(child.pid) + '\\n');
setTimeout(() => {}, 60000);
`;

const leftovers: number[] = [];
afterEach(() => {
  for (const pid of leftovers.splice(0)) {
    try {
      process.kill(pid);
    } catch {
      // Already gone, which is what the test wants anyway.
    }
  }
});

function startParent() {
  const parent = spawn(process.execPath, ['-e', PARENT], { stdio: 'pipe' });
  const started = new Promise<void>((resolve) => {
    parent.stdout.once('data', () => {
      resolve();
    });
  });
  return { parent, started };
}

function remember(stdout: string): void {
  const pid = Number(stdout.trim().split('\n')[0]);
  if (Number.isInteger(pid) && pid > 0) leftovers.push(pid);
}

describe('collect', () => {
  it('passes input and gathers output and the exit code', async () => {
    const child = spawn(process.execPath, ['-e', 'process.stdin.pipe(process.stdout)'], {
      stdio: 'pipe',
    });
    await expect(collect(child, { input: 'hello' })).resolves.toEqual({
      code: 0,
      stdout: 'hello',
      stderr: '',
      timedOut: false,
    });
  });

  it('returns soon after an abort, even while a child process still holds the pipes', async () => {
    const { parent, started } = startParent();
    const controller = new AbortController();
    const result = collect(parent, { signal: controller.signal });
    await started;
    const abortedAt = Date.now();
    controller.abort();
    const { code, stdout, timedOut } = await result;
    remember(stdout);
    expect(Date.now() - abortedAt).toBeLessThan(3000);
    expect(code).toBeNull();
    expect(timedOut).toBe(false);
  });

  it('returns soon after a timeout, even while a child process still holds the pipes', async () => {
    const { parent } = startParent();
    const startedAt = Date.now();
    const { stdout, timedOut } = await collect(parent, { timeoutMs: 1000 });
    remember(stdout);
    expect(timedOut).toBe(true);
    expect(Date.now() - startedAt).toBeLessThan(4000);
  });
});

describe('dockerExec', () => {
  it('starts nothing once the run is aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(dockerExec(['version'], { env: {}, signal: controller.signal })).resolves.toEqual({
      code: null,
      stdout: '',
      stderr: '',
      timedOut: false,
    });
  });
});
