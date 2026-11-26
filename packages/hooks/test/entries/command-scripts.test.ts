import { execFileSync, spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildHooks } from '../../build.mjs';
import { isPaused } from '../../src/lib/state.js';

const root = mkdtempSync(join(tmpdir(), 'theoldman-commands-'));
const outDir = join(root, 'scripts');

beforeAll(async () => {
  await buildHooks({ outDir });
  // The review script reads topic rules from the skills folder next to its own, as in the plugin.
  const skills = fileURLToPath(new URL('../../../../plugin/skills', import.meta.url));
  cpSync(skills, join(root, 'skills'), { recursive: true });
});
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

let dirs = 0;
function newDir(files: Record<string, string> = {}): string {
  dirs += 1;
  const dir = join(root, `project ${String(dirs)}`);
  mkdirSync(dir);
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

function run(script: string, args: string[], cwd = root) {
  const result = spawnSync(process.execPath, [join(outDir, script), ...args], {
    cwd,
    encoding: 'utf8',
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function git(cwd: string, ...args: string[]): void {
  execFileSync(
    'git',
    ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args],
    { cwd, stdio: 'ignore' },
  );
}

// These tests build git repos and start the scripts as processes; under the full parallel suite
// on Windows that can pass the default 5 s.
describe('oldman-pause.mjs', { timeout: 30_000 }, () => {
  it('pauses and resumes the project it is given, and says what that means', () => {
    const dir = newDir();
    expect(run('oldman-pause.mjs', ['off', dir])).toEqual({
      status: 0,
      stdout:
        'theoldman is paused for this project: the rules summary, prompt rules, edit checks and review are off. The guards stay on. Run /theoldman:on to resume.\n',
      stderr: '',
    });
    expect(isPaused(dir)).toBe(true);
    expect(run('oldman-pause.mjs', ['on', dir]).stdout).toMatch(/^theoldman is on again/);
    expect(isPaused(dir)).toBe(false);
  });

  it('uses the working directory without a project argument, and rejects other modes', () => {
    const dir = newDir();
    expect(run('oldman-pause.mjs', ['off'], dir).status).toBe(0);
    expect(isPaused(dir)).toBe(true);
    expect(run('oldman-pause.mjs', ['pause', dir])).toEqual({
      status: 1,
      stdout: '',
      stderr: 'theoldman: usage: oldman-pause.mjs on|off [project dir]\n',
    });
  });
});

describe('oldman-review-diff.mjs', { timeout: 30_000 }, () => {
  function repo(): string {
    const dir = newDir({
      'src/a.ts': 'export const a = 1;\n',
      'src/b.ts': 'export const b = 1;\n',
    });
    git(dir, 'init', '-q', '-b', 'main');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'base');
    return dir;
  }

  it("writes the branch's committed, uncommitted and untracked changes against main", () => {
    const dir = repo();
    git(dir, 'checkout', '-q', '-b', 'feature');
    writeFileSync(join(dir, 'src', 'a.ts'), 'export const a = 2;\n');
    git(dir, 'commit', '-q', '-am', 'change a');
    writeFileSync(join(dir, 'src', 'b.ts'), 'export const b = 2;\n');
    writeFileSync(join(dir, 'src', 'new.ts'), 'export const n = 1;\n');
    const result = run('oldman-review-diff.mjs', ['s1', dir]);
    const path = join(dir, '.theoldman', 'state', 's1', 'diff.patch');
    expect(result.stdout).toMatch(
      new RegExp(`^Diff of 3 changed file\\(s\\) against main \\(from [0-9a-f]{7}\\) written to `),
    );
    expect(result.stdout.trim().endsWith(path)).toBe(true);
    const diff = readFileSync(path, 'utf8');
    for (const text of ['+export const a = 2;', '+export const b = 2;', '+++ b/src/new.ts']) {
      expect(diff).toContain(text);
    }
  });

  it('writes the topic rules that fit the changed files, and names them', () => {
    const dir = repo();
    mkdirSync(join(dir, 'prisma'));
    writeFileSync(join(dir, 'prisma', 'schema.prisma'), 'model Order {\n  id String @id\n}\n');
    const lines = run('oldman-review-diff.mjs', ['s1', dir]).stdout.trim().split('\n');
    const rules = join(dir, '.theoldman', 'state', 's1', 'review-rules.md');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe(`Topic rules for this change: ${rules}`);
    expect(readFileSync(rules, 'utf8')).toMatch(/^# Database\n/);
  });

  it("prefers the remote's default branch", () => {
    const dir = repo();
    git(dir, 'checkout', '-q', '-b', 'develop');
    git(dir, 'update-ref', 'refs/remotes/origin/develop', 'HEAD');
    git(dir, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/develop');
    writeFileSync(join(dir, 'src', 'a.ts'), 'export const a = 3;\n');
    expect(run('oldman-review-diff.mjs', ['s1', dir]).stdout).toMatch(/against origin\/develop \(/);
  });

  it('says so when there is nothing to review, or no git repository', () => {
    const dir = repo();
    expect(run('oldman-review-diff.mjs', ['s1', dir]).stdout).toMatch(
      /^No changes against main \(from [0-9a-f]{7}\), so there is nothing to review\.\n$/,
    );
    expect(existsSync(join(dir, '.theoldman', 'state', 's1', 'diff.patch'))).toBe(false);
    expect(run('oldman-review-diff.mjs', ['s1', newDir()]).stdout).toBe(
      'This project is not a git repository, so there is no branch diff to review.\n',
    );
  });

  it('compares with the last commit when there is no default branch, and fails on a bad session ID', () => {
    const dir = newDir({ 'a.ts': 'a\n' });
    git(dir, 'init', '-q', '-b', 'trunk');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'base');
    writeFileSync(join(dir, 'a.ts'), 'b\n');
    expect(run('oldman-review-diff.mjs', ['s1', dir]).stdout).toMatch(/against the last commit/);
    const bad = run('oldman-review-diff.mjs', ['../x', dir]);
    expect(bad.status).toBe(1);
    expect(bad.stderr).toMatch(/^theoldman: internal error: invalid session id/);
  });
});

describe('oldman-init.mjs', { timeout: 30_000 }, () => {
  const pkg = JSON.stringify({
    dependencies: { next: '15.0.0' },
    devDependencies: { typescript: '5.0.0' },
  });

  it('writes the config with the detected stack and adds the CLAUDE.md section once', () => {
    const dir = newDir({ 'package.json': pkg });
    expect(run('oldman-init.mjs', [dir]).stdout).toBe(
      'Wrote .theoldman.json with the stack detected from package.json: typescript, nextjs.\nCreated CLAUDE.md with a theoldman section.\n',
    );
    expect(JSON.parse(readFileSync(join(dir, '.theoldman.json'), 'utf8'))).toEqual({
      level: 'standard',
      stack: ['typescript', 'nextjs'],
    });
    const claude = readFileSync(join(dir, 'CLAUDE.md'), 'utf8');
    expect(claude.startsWith('## theoldman\n')).toBe(true);
    expect(run('oldman-init.mjs', [dir]).stdout).toBe(
      'Kept the existing .theoldman.json.\nCLAUDE.md already has a theoldman section.\n',
    );
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8')).toBe(claude);
  });

  it('appends after existing CLAUDE.md text, and works without package.json', () => {
    const dir = newDir({ 'CLAUDE.md': '# My project\r\nUse pnpm.' });
    expect(run('oldman-init.mjs', [], dir).stdout).toBe(
      'Wrote .theoldman.json; no stack was detected from package.json, so "stack" is empty.\nAdded a theoldman section to CLAUDE.md.\n',
    );
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8')).toMatch(
      /^# My project\r\nUse pnpm\.\n\n## theoldman\n/,
    );
  });

  it('leaves a CLAUDE.md that is not a regular file alone', () => {
    const dir = newDir();
    mkdirSync(join(dir, 'CLAUDE.md'));
    expect(run('oldman-init.mjs', [dir]).stdout).toContain(
      'Left CLAUDE.md alone: it is not a regular file.',
    );
  });
});
