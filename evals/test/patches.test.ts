import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DockerExec } from '../src/docker.ts';
import { refreshArgs, refreshPatch } from '../src/patches.ts';
import { loadTask } from '../src/task.ts';

const DOCKER_DIR = fileURLToPath(new URL('../docker/', import.meta.url));
const SCRIPT = join(DOCKER_DIR, 'refresh-patch.mjs');

const git = (cwd: string, ...args: string[]): string =>
  execFileSync(
    'git',
    ['-c', 'core.autocrlf=false', '-c', 'user.name=t', '-c', 'user.email=t@x.invalid', ...args],
    { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
  );

const README = [
  '# Shop',
  '',
  'Setup line',
  '',
  '## API',
  '',
  '| Route | What |',
  '| a | b |',
  '',
].join('\n');

// Each case builds and merges scratch git repositories, which can take seconds on a busy machine.
describe('refreshing a reference patch', { timeout: 60_000 }, () => {
  let repo: string;
  const starter = (): string => join(repo, 'evals', 'starters', 'shop');
  const taskDir = (): string => join(repo, 'evals', 'tasks', 'add-route');
  const patchFile = (): string => join(taskDir(), 'reference.patch');
  const task = () => loadTask(join(repo, 'evals', 'tasks'), 'add-route');

  /** The reference: a new README row and a new file, as a diff against the starter. */
  function makeReference(): string {
    const work = mkdtempSync(join(tmpdir(), 'theoldman-ref-'));
    cpSync(starter(), work, { recursive: true });
    git(work, 'init', '-q');
    git(work, 'add', '-A');
    git(work, 'commit', '-q', '-m', 'starter');
    writeFileSync(join(work, 'README.md'), README.replace('| a | b |', '| a | b |\n| c | d |'));
    writeFileSync(join(work, 'src', 'b.ts'), 'export const b = 2;\n');
    git(work, 'add', '-A');
    const diff = git(work, 'diff', '--cached', '--binary');
    rmSync(work, { recursive: true, force: true });
    return diff;
  }

  /** Docker that runs the container script directly, with the repository where it really is. */
  const scriptDocker: DockerExec = (args) => {
    const config = JSON.parse(args.at(-1) ?? '{}') as Record<string, unknown>;
    const ran = spawnSync(process.execPath, [SCRIPT, JSON.stringify({ ...config, repo })], {
      encoding: 'utf8',
    });
    return Promise.resolve({
      code: ran.status,
      stdout: ran.stdout,
      stderr: ran.stderr,
      timedOut: false,
    });
  };

  const refresh = () =>
    refreshPatch(
      scriptDocker,
      { task: task(), repoRoot: repo, fromRef: 'HEAD', dockerDir: DOCKER_DIR },
      {},
    );

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'theoldman-patches-'));
    mkdirSync(join(starter(), 'src'), { recursive: true });
    writeFileSync(join(starter(), 'README.md'), README);
    writeFileSync(join(starter(), 'src', 'a.ts'), 'export const a = 1;\n');
    mkdirSync(join(taskDir(), 'hidden'), { recursive: true });
    writeFileSync(join(taskDir(), 'hidden', 'b.hidden.test.ts'), '');
    writeFileSync(join(taskDir(), 'prompt.md'), 'Add route c.\n');
    writeFileSync(
      join(taskDir(), 'task.json'),
      JSON.stringify({
        title: 'Add route',
        base: 'shop',
        hiddenTests: 'hidden',
        timeoutMinutes: 5,
      }),
    );
    writeFileSync(patchFile(), makeReference());
    git(repo, 'init', '-q');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'tasks');
  });
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  /** The starter's README with the patch applied, or null if it does not apply. */
  function applied(): string | null {
    const work = mkdtempSync(join(tmpdir(), 'theoldman-apply-'));
    try {
      cpSync(starter(), work, { recursive: true });
      git(work, 'apply', patchFile());
      return readFileSync(join(work, 'README.md'), 'utf8');
    } catch {
      return null;
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }

  it('leaves a patch alone when the starter did not change', async () => {
    const before = readFileSync(patchFile(), 'utf8');
    expect(await refresh()).toBe('unchanged');
    expect(readFileSync(patchFile(), 'utf8')).toBe(before);
  });

  it('moves the patch onto a starter change it does not touch', async () => {
    // A line in the patch's context changes, so the old patch no longer applies as is.
    writeFileSync(
      join(starter(), 'README.md'),
      README.replace('| Route | What |', '| Route | Use |'),
    );
    expect(applied()).toBeNull();
    expect(await refresh()).toBe('updated');
    const readme = applied();
    expect(readme).toContain('| Route | Use |');
    expect(readme).toContain('| c | d |');
  });

  it('reports a conflict and keeps the patch when the starter changed the same lines', async () => {
    const before = readFileSync(patchFile(), 'utf8');
    writeFileSync(join(starter(), 'README.md'), README.replace('| a | b |', '| a | changed |'));
    expect(await refresh()).toBe('conflict');
    expect(readFileSync(patchFile(), 'utf8')).toBe(before);
  });

  it('runs the merge offline, with the repository read-only and no environment', () => {
    const args = refreshArgs({
      task: task(),
      repoRoot: repo,
      fromRef: 'main',
      dockerDir: DOCKER_DIR,
    });
    expect(args.slice(args.indexOf('--network'), args.indexOf('--network') + 2)).toEqual([
      '--network',
      'none',
    ]);
    expect(args).toContain(`type=bind,source=${repo},target=/repo,readonly`);
    expect(args).not.toContain('-e');
    expect(JSON.parse(args.at(-1) ?? '{}')).toEqual({
      repo: '/repo',
      ref: 'main',
      starterDirs: ['evals/starters/shop'],
      patch: 'evals/tasks/add-route/reference.patch',
    });
  });

  it('says so when a task has no reference', async () => {
    rmSync(patchFile());
    expect(await refresh()).toBe('no-reference');
  });
});
