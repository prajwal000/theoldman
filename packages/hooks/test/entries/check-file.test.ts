import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildHooks } from '../../build.mjs';
import { cappedFindings, setPaused, touchedFiles } from '../../src/lib/state.js';

const root = mkdtempSync(join(tmpdir(), 'theoldman-check-file-'));
const outDir = join(root, 'scripts');

beforeAll(async () => {
  await buildHooks({ outDir });
});
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

let projects = 0;
function newProject(config?: object, parent = root): string {
  projects += 1;
  const dir = join(parent, `project-${String(projects)}`);
  mkdirSync(dir, { recursive: true });
  if (config !== undefined) writeFileSync(join(dir, '.theoldman.json'), JSON.stringify(config));
  return dir;
}

function runCheck(project: string, toolName: string, toolInput: object, cwd = project) {
  const inherited = { ...process.env };
  delete inherited.CLAUDE_PROJECT_DIR;
  const stdin = JSON.stringify({
    session_id: 's1',
    cwd,
    hook_event_name: 'PostToolUse',
    tool_name: toolName,
    tool_input: toolInput,
    tool_response: {},
  });
  const result = spawnSync(process.execPath, [join(outDir, 'check-file.mjs')], {
    input: stdin,
    encoding: 'utf8',
    env: { ...inherited, CLAUDE_PROJECT_DIR: project },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

const write = (project: string, file: string, content: string) =>
  runCheck(project, 'Write', { file_path: join(project, file), content });

function output(run: ReturnType<typeof runCheck>): Record<string, unknown> {
  expect(run.status).toBe(0);
  expect(run.stderr).toBe('');
  return JSON.parse(run.stdout) as Record<string, unknown>;
}

const NARRATION = 'export function load(): void {\n  // Added retry logic for flaky requests\n}\n';
const REPEAT = '// get user\nexport const user = getUser(id);\n';
const C01 =
  'Move change notes to the commit message; a comment should say why the code is as it is.';

describe('check-file hook', () => {
  it('asks for a fix, naming the file relative to the project root', () => {
    const project = newProject();
    mkdirSync(join(project, 'src', 'deep'), { recursive: true });
    const run = runCheck(
      project,
      'Write',
      { file_path: join(project, 'src', 'a.ts'), content: NARRATION },
      join(project, 'src', 'deep'),
    );
    expect(output(run)).toEqual({ decision: 'block', reason: `OLDMAN-C01 src/a.ts:2 ${C01}` });
    expect(touchedFiles(project, 's1')).toEqual(['src/a.ts']);
    expect(readFileSync(join(project, '.theoldman', '.gitignore'), 'utf8')).toBe('*\n');
  });

  it('passes warnings on as context without asking for a fix', () => {
    const project = newProject();
    expect(output(write(project, 'user.ts', REPEAT))).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: expect.stringMatching(/^OLDMAN-C02 user\.ts:1 /) as unknown,
      },
    });
  });

  it('sends fixes and warnings together', () => {
    const project = newProject();
    const result = output(write(project, 'a.ts', `${REPEAT}${NARRATION}`));
    expect(result).toMatchObject({ decision: 'block', reason: `OLDMAN-C01 a.ts:4 ${C01}` });
    expect(result.hookSpecificOutput).toMatchObject({
      additionalContext: expect.stringMatching(/^OLDMAN-C02 a\.ts:1 /) as unknown,
    });
  });

  it('checks only the lines an Edit added, numbered as in the edited file', () => {
    const project = newProject();
    const file = join(project, 'b.ts');
    writeFileSync(file, 'const a = 1;\n// Added the second value\nconst b = 2;\n// Added a note\n');
    const edit = {
      file_path: file,
      old_string: '// Old',
      new_string: '// Added a note',
      replace_all: false,
    };
    expect(output(runCheck(project, 'Edit', edit))).toMatchObject({
      reason: `OLDMAN-C01 b.ts:4 ${C01}`,
    });
  });

  it('checks nothing while paused, but still records the touched file', () => {
    const project = newProject();
    setPaused(project, true);
    expect(write(project, 'a.ts', NARRATION)).toEqual({ status: 0, stdout: '', stderr: '' });
    expect(touchedFiles(project, 's1')).toEqual(['a.ts']);
  });

  it('skips ignored paths and disabled rules', () => {
    const project = newProject({ ignorePaths: ['legacy/**'], disable: ['OLDMAN-Q04'] });
    expect(write(project, 'legacy/a.ts', NARRATION).stdout).toBe('');
    expect(write(project, 'src/b.ts', 'debugger;\n').stdout).toBe('');
    expect(output(write(project, 'src/c.ts', 'const x: any = 1;\n'))).toMatchObject({
      reason: expect.stringMatching(/^OLDMAN-Q01 src\/c\.ts:1 /) as unknown,
    });
  });

  it('stops asking after maxFeedbackRounds per check type and records what is left', () => {
    const project = newProject({ maxFeedbackRounds: 1 });
    expect(output(write(project, 'a.ts', NARRATION))).toMatchObject({ decision: 'block' });
    expect(write(project, 'a.ts', NARRATION)).toEqual({ status: 0, stdout: '', stderr: '' });
    expect(cappedFindings(project, 's1')).toEqual({ 'a.ts': [`OLDMAN-C01 a.ts:2 ${C01}`] });
    expect(output(write(project, 'b.ts', 'debugger;\n'))).toMatchObject({
      reason: expect.stringMatching(/^OLDMAN-Q04 b\.ts:1 /) as unknown,
    });
    expect(write(project, 'a.ts', 'export const a = 1;\n').stdout).toBe('');
    expect(cappedFindings(project, 's1')).toEqual({});
  });

  it('matches folder exemptions only inside the project, not in the path above it', () => {
    const project = newProject(undefined, join(root, 'scripts-parent', 'scripts', 'app'));
    const log = 'export function run(): void {\n  console.log("x");\n}\n';
    expect(output(write(project, 'src/x.ts', log))).toMatchObject({
      reason: expect.stringMatching(/^OLDMAN-Q02 src\/x\.ts:2 /) as unknown,
    });
    expect(write(project, 'scripts/build.ts', log).stdout).toBe('');
  });

  it('says nothing about a clean file', () => {
    const project = newProject();
    expect(write(project, 'a.ts', 'export const answer = 42;\n')).toEqual({
      status: 0,
      stdout: '',
      stderr: '',
    });
  });

  it('fails open on input that is not a Write or Edit call', () => {
    expect(runCheck(newProject(), 'Bash', { command: 'ls' })).toEqual({
      status: 1,
      stdout: '',
      stderr: 'theoldman: invalid hook input\n',
    });
  });
});
