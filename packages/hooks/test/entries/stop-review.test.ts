import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildHooks } from '../../build.mjs';
import { recordBaseline } from '../../src/lib/session-changes.js';
import {
  getRounds,
  recordCappedFindings,
  recordTouchedFile,
  setPaused,
} from '../../src/lib/state.js';

const root = mkdtempSync(join(tmpdir(), 'theoldman-stop-'));
const outDir = join(root, 'scripts');

beforeAll(async () => {
  await buildHooks({ outDir });
});
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): void {
  execFileSync(
    'git',
    ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args],
    { cwd, stdio: 'ignore' },
  );
}

function write(dir: string, files: Record<string, string>): void {
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), content);
  }
}

let projects = 0;
/** A committed repo with the session baseline taken, as SessionStart does. */
function newRepo(files: Record<string, string> = {}): string {
  projects += 1;
  const dir = join(root, `repo-${String(projects)}`);
  mkdirSync(dir);
  git(dir, 'init', '-q');
  write(dir, { '.gitignore': '.theoldman/\n', 'src/a.ts': 'export const a = 1;\n', ...files });
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  recordBaseline(dir, 's1');
  return dir;
}

/** Writes files as Write/Edit would, recording them as touched. */
function edit(dir: string, files: Record<string, string>): void {
  write(dir, files);
  for (const name of Object.keys(files)) recordTouchedFile(dir, 's1', name);
}

function runStop(dir: string, extra: object = {}, stdin?: string) {
  const inherited = { ...process.env };
  delete inherited.CLAUDE_PROJECT_DIR;
  const input = { session_id: 's1', cwd: dir, hook_event_name: 'Stop', stop_hook_active: false };
  const result = spawnSync(process.execPath, [join(outDir, 'stop-review.mjs')], {
    input: stdin ?? JSON.stringify({ ...input, ...extra }),
    encoding: 'utf8',
    env: { ...inherited, CLAUDE_PROJECT_DIR: dir },
  });
  // On Stop, additionalContext makes Claude take another turn, so no output may ever carry it.
  expect(result.stdout).not.toContain('additionalContext');
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

const silent = { status: 0, stdout: '', stderr: '' };

function blocked(run: ReturnType<typeof runStop>): string {
  expect(run.status).toBe(0);
  const output = JSON.parse(run.stdout) as Record<string, unknown>;
  expect(Object.keys(output).sort()).toEqual(['decision', 'reason']);
  expect(output.decision).toBe('block');
  return String(output.reason);
}

function notified(run: ReturnType<typeof runStop>): string {
  expect(run.status).toBe(0);
  const output = JSON.parse(run.stdout) as Record<string, unknown>;
  expect(Object.keys(output)).toEqual(['systemMessage']);
  return String(output.systemMessage);
}

// Each test builds a git repo and starts the hook several times (about 270 ms a run on
// Windows); under the full parallel suite that can pass the default 5 s.
describe('stop-review hook', { timeout: 30_000 }, () => {
  it('says nothing when the session changed no code', () => {
    const dir = newRepo();
    expect(runStop(dir)).toEqual(silent);
    edit(dir, { 'README.md': '# Docs only\n', 'docs/guide.md': 'x\n' });
    expect(runStop(dir)).toEqual(silent);
  });

  it("ignores theoldman's own config and the paths in ignorePaths", () => {
    const dir = newRepo();
    write(dir, { '.theoldman.json': JSON.stringify({ ignorePaths: ['generated/**'] }) });
    write(dir, { 'CLAUDE.md': '## theoldman\n', 'generated/api.ts': 'export const x = 1;\n' });
    expect(runStop(dir)).toEqual(silent);
  });

  it('asks once for the review, with the diff of the session written to the state file', () => {
    const dir = newRepo();
    edit(dir, { 'src/a.ts': 'export const a = 2;\n', 'src/new.ts': 'export const n = 1;\n' });
    const reason = blocked(runStop(dir));
    const diffPath = join(dir, '.theoldman', 'state', 's1', 'diff.patch');
    expect(reason).toContain(
      `1. Run the theoldman:oldman-reviewer subagent with the prompt: Review the diff at ${diffPath}.`,
    );
    expect(reason).toContain('theoldman:oldman-verifier');
    const diff = readFileSync(diffPath, 'utf8');
    expect(diff).toContain('+export const a = 2;');
    expect(diff).toContain('+++ b/src/new.ts');
    expect(getRounds(dir, 's1', 'review')).toBe(1);
    expect(runStop(dir)).toEqual(silent);
  });

  it('leaves out uncommitted work from before the session, but catches changes made by Bash', () => {
    const dir = newRepo({ 'src/b.ts': 'export const b = 1;\n' });
    write(dir, { 'src/a.ts': 'export const a = "user, before the session";\n' });
    rmSync(join(dir, '.theoldman'), { recursive: true });
    recordBaseline(dir, 's1');
    expect(runStop(dir)).toEqual(silent);
    write(dir, { 'src/b.ts': 'export const b = 2;\n' });
    blocked(runStop(dir));
    const diff = readFileSync(join(dir, '.theoldman', 'state', 's1', 'diff.patch'), 'utf8');
    expect(diff).toContain('src/b.ts');
    expect(diff).not.toContain('user, before the session');
  });

  it('never loops: quiet while stop_hook_active, and the fixes made then count as reviewed', () => {
    const dir = newRepo();
    edit(dir, { 'src/a.ts': 'export const a = 2;\n' });
    blocked(runStop(dir));
    edit(dir, { 'src/a.ts': 'export const a = 3;\n' });
    expect(runStop(dir, { stop_hook_active: true })).toEqual(silent);
    expect(runStop(dir)).toEqual(silent);
    edit(dir, { 'src/a.ts': 'export const a = 4;\n' });
    blocked(runStop(dir));
    expect(getRounds(dir, 's1', 'review')).toBe(2);
  });

  it('stops asking after maxFeedbackRounds and tells the user once', () => {
    const dir = newRepo({ '.theoldman.json': JSON.stringify({ maxFeedbackRounds: 1 }) });
    edit(dir, { 'src/a.ts': 'export const a = 2;\n' });
    blocked(runStop(dir));
    edit(dir, { 'src/a.ts': 'export const a = 3;\n' });
    expect(notified(runStop(dir))).toBe(
      'theoldman:\nReview skipped: this session already had 1 reviews (maxFeedbackRounds).',
    );
    edit(dir, { 'src/a.ts': 'export const a = 4;\n' });
    expect(runStop(dir)).toEqual(silent);
  });

  it('puts the docs fix, leftovers and notes in the block reason', () => {
    const dir = newRepo({ 'package.json': '{ "name": "app", "scripts": { "dev": "vite" } }\n' });
    edit(dir, {
      'src/a.ts': 'export const key = process.env.API_KEY;\n',
      'package.json': '{ "name": "app", "scripts": { "dev": "vite", "test": "vitest" } }\n',
    });
    recordCappedFindings(dir, 's1', 'src/a.ts', ['OLDMAN-C01 src/a.ts:1 Move change notes.']);
    const reason = blocked(runStop(dir));
    expect(reason).toMatch(
      /4\. Fix these docs findings:\nOLDMAN-D01 src\/a\.ts:1 process\.env\.API_KEY/,
    );
    expect(reason).toContain(
      'Left after the feedback limit; mention them in your summary:\nOLDMAN-C01 src/a.ts:1 Move change notes.',
    );
    expect(reason).toMatch(/Notes, no fix required:\nOLDMAN-D04 package\.json:1 /);
    expect(getRounds(dir, 's1', 'docs')).toBe(1);
  });

  it('at level quick, asks only for docs fixes and sends warnings to the user', () => {
    const quick = JSON.stringify({ level: 'quick' });
    const dir = newRepo({ '.theoldman.json': quick, 'package.json': '{ "scripts": {} }\n' });
    edit(dir, { 'src/a.ts': 'export const key = process.env.API_KEY;\n' });
    const reason = blocked(runStop(dir));
    expect(reason).not.toContain('oldman-reviewer');
    expect(reason).toContain('1. Fix these docs findings:');
    const other = newRepo({ '.theoldman.json': quick, 'package.json': '{ "scripts": {} }\n' });
    edit(other, {
      'package.json': '{ "scripts": { "test": "vitest" } }\n',
      'src/a.ts': 'export {};\n',
    });
    expect(notified(runStop(other))).toMatch(/^theoldman:\nNotes:\nOLDMAN-D04 package\.json:1 /);
  });

  it('skips the review when review.onStop is false, and skips disabled rules', () => {
    const config = { review: { onStop: false }, disable: ['OLDMAN-D01'] };
    const dir = newRepo({ '.theoldman.json': JSON.stringify(config) });
    edit(dir, { 'src/a.ts': 'export const key = process.env.API_KEY;\n' });
    expect(runStop(dir)).toEqual(silent);
  });

  it('reviews touched files outside a git repository as new files', () => {
    projects += 1;
    const dir = join(root, `loose-${String(projects)}`);
    mkdirSync(dir);
    edit(dir, { 'app.ts': 'export const x = 1;\n' });
    blocked(runStop(dir));
    expect(readFileSync(join(dir, '.theoldman', 'state', 's1', 'diff.patch'), 'utf8')).toContain(
      '+export const x = 1;',
    );
  });

  it('does nothing while paused, and fails open on invalid input', () => {
    const dir = newRepo();
    edit(dir, { 'src/a.ts': 'export const a = 2;\n' });
    setPaused(dir, true);
    expect(runStop(dir)).toEqual(silent);
    expect(existsSync(join(dir, '.theoldman', 'state', 's1', 'diff.patch'))).toBe(false);
    expect(runStop(dir, {}, '{"hook_event_name": "Stop"}')).toEqual({
      status: 1,
      stdout: '',
      stderr: 'theoldman: invalid hook input\n',
    });
  });
});
