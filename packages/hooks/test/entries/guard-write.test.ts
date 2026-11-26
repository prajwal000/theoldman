import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildHooks } from '../../build.mjs';
import { FAKE_SECRETS } from '../rules/fake-secrets.js';

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

const write = (filePath: string, content = 'X=1\n', cwd = project): string =>
  input('Write', { file_path: filePath, content }, cwd);

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

  it('denies a Write whose content holds a secret, naming the line but never the value', () => {
    const secret = FAKE_SECRETS['stripe-live'] ?? '';
    const run = runGuard(
      write(join(project, 'src', 'pay.ts'), `// pay\nconst key = '${secret}';\n`),
    );
    expect(reason(run)).toMatch(/^OLDMAN-S01: .*pay\.ts:2 looks like a Stripe live key\./);
    expect(run.stdout + run.stderr).not.toContain(secret);
    expect(run.stdout + run.stderr).not.toContain(secret.slice(-8));
  });

  it('numbers an Edit by its line in the current file', () => {
    const file = join(project, 'config.ts');
    writeFileSync(file, 'line 1\nline 2\nconst apiKey = OLD;\n');
    const secret = FAKE_SECRETS['high-entropy'] ?? '';
    const edit = {
      file_path: file,
      old_string: 'const apiKey = OLD;',
      new_string: `const apiKey = '${secret}';`,
      replace_all: false,
    };
    const run = runGuard(input('Edit', edit));
    expect(reason(run)).toMatch(/config\.ts:3 looks like a secret value assigned to apiKey\./);
    expect(run.stdout).not.toContain(secret);
    const missing = input('Edit', { ...edit, file_path: join(project, 'none.ts') });
    expect(reason(runGuard(missing))).toMatch(/none\.ts:1 looks like/);
  });

  it('lists at most five findings and counts the rest', () => {
    const lines = Object.values(FAKE_SECRETS).map((value) => `const serviceToken = '${value}';`);
    const run = runGuard(write(join(project, '.env.local'), lines.join('\n')));
    const listed = String(reason(run)).split('\n');
    expect(listed).toHaveLength(6);
    expect(listed[0]).toMatch(/^OLDMAN-G05: /);
    expect(listed[5]).toBe(`...and ${String(lines.length + 1 - 5)} more.`);
    for (const value of Object.values(FAKE_SECRETS)) expect(run.stdout).not.toContain(value);
  });

  it('skips a rule listed in disable in the project root config', () => {
    const configured = join(root, 'configured');
    mkdirSync(join(configured, 'sub'), { recursive: true });
    writeFileSync(join(configured, '.theoldman.json'), JSON.stringify({ disable: ['OLDMAN-G05'] }));
    const env = { CLAUDE_PROJECT_DIR: configured };
    expect(runGuard(write('.env', 'X=1\n', join(configured, 'sub')), env).stdout).toBe('');
    expect(reason(runGuard(write('server.key', 'X=1\n', join(configured, 'sub')), env))).toMatch(
      /^OLDMAN-G06/,
    );
  });
});
