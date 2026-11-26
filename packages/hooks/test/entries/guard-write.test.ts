import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildHooks } from '../../build.mjs';

const root = mkdtempSync(join(tmpdir(), 'theoldman-guard-write-'));
const outDir = join(root, 'scripts');
const project = join(root, 'project');

beforeAll(async () => {
  await buildHooks({ outDir });
  mkdirSync(project);
});
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function runGuard(stdin: string, env: Record<string, string> = {}) {
  const inherited = { ...process.env };
  delete inherited.CLAUDE_PROJECT_DIR;
  const result = spawnSync(process.execPath, [join(outDir, 'guard-write.mjs')], {
    input: stdin,
    encoding: 'utf8',
    env: { ...inherited, ...env },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

const input = (toolName: string, toolInput: object, cwd = project): string =>
  JSON.stringify({
    session_id: 's1',
    cwd,
    hook_event_name: 'PreToolUse',
    tool_name: toolName,
    tool_input: toolInput,
  });

const write = (filePath: string, cwd = project): string =>
  input('Write', { file_path: filePath, content: 'X=1\n' }, cwd);

function reason(run: ReturnType<typeof runGuard>): unknown {
  expect(run.status).toBe(0);
  const output: unknown = JSON.parse(run.stdout);
  expect(output).toMatchObject({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny' },
  });
  return (output as { hookSpecificOutput: { permissionDecisionReason: unknown } })
    .hookSpecificOutput.permissionDecisionReason;
}

describe('guard-write hook', () => {
  it('denies a Write to an env file and an Edit of a key file', () => {
    expect(reason(runGuard(write(join(project, '.env.local'))))).toMatch(/^OLDMAN-G05: /);
    const edit = input('Edit', {
      file_path: 'C:\\Users\\me\\.ssh\\id_rsa',
      old_string: 'a',
      new_string: 'b',
      replace_all: false,
    });
    expect(reason(runGuard(edit))).toMatch(/^OLDMAN-G06: /);
  });

  it('says nothing about other files', () => {
    expect(runGuard(write(join(project, '.env.example')))).toEqual({
      status: 0,
      stdout: '',
      stderr: '',
    });
  });

  it('fails open on input that is not a Write or Edit call', () => {
    expect(runGuard(input('Bash', { command: 'ls' }))).toEqual({
      status: 1,
      stdout: '',
      stderr: 'theoldman: invalid hook input\n',
    });
  });

  it('skips a rule listed in disable in the project root config', () => {
    const configured = join(root, 'configured');
    mkdirSync(join(configured, 'sub'), { recursive: true });
    writeFileSync(join(configured, '.theoldman.json'), JSON.stringify({ disable: ['OLDMAN-G05'] }));
    const env = { CLAUDE_PROJECT_DIR: configured };
    expect(runGuard(write('.env', join(configured, 'sub')), env).stdout).toBe('');
    expect(reason(runGuard(write('server.key', join(configured, 'sub')), env))).toMatch(
      /^OLDMAN-G06/,
    );
  });
});
