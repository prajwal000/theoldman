import { execFileSync, spawnSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildHooks } from '../../build.mjs';

const root = mkdtempSync(join(tmpdir(), 'theoldman-guard-bash-'));
const outDir = join(root, 'scripts');
const project = join(root, 'project');

beforeAll(async () => {
  await buildHooks({ outDir });
  mkdirSync(project);
});
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Runs the built hook. The environment is controlled: a Claude Code session running these tests
 * would otherwise pass its own CLAUDE_PROJECT_DIR and DATABASE_URL to the hook.
 */
function runGuard(stdin: string, env: Record<string, string> = {}): Run {
  const inherited = { ...process.env };
  delete inherited.CLAUDE_PROJECT_DIR;
  delete inherited.DATABASE_URL;
  const result = spawnSync(process.execPath, [join(outDir, 'guard-bash.mjs')], {
    input: stdin,
    encoding: 'utf8',
    env: { ...inherited, ...env },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function hookInput(toolName: string, command: string, cwd = project): string {
  return JSON.stringify({
    session_id: 's1',
    cwd,
    hook_event_name: 'PreToolUse',
    tool_name: toolName,
    tool_input: { command, description: 'test' },
  });
}

function denyReason(run: Run): string {
  expect(run.status).toBe(0);
  const output: unknown = JSON.parse(run.stdout);
  expect(output).toMatchObject({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny' },
  });
  const reason = (output as { hookSpecificOutput: { permissionDecisionReason: unknown } })
    .hookSpecificOutput.permissionDecisionReason;
  expect(typeof reason).toBe('string');
  return String(reason);
}

describe('guard-bash hook', () => {
  it('denies a force-push to main from the Bash tool', () => {
    expect(denyReason(runGuard(hookInput('Bash', 'git push -f origin main')))).toMatch(
      /^OLDMAN-G01: force-pushing to main/,
    );
  });

  it('denies a force-push to main from the PowerShell tool', () => {
    const run = runGuard(hookInput('PowerShell', '$env:FOO=1; git push -f origin main'));
    expect(denyReason(run)).toContain('OLDMAN-G01');
  });

  it('lists every rule that matched, one per line, in the order they appear', () => {
    const run = runGuard(hookInput('Bash', 'git commit -n -m x && git push -f origin main'));
    expect(
      denyReason(run)
        .split('\n')
        .map((line) => line.split(':')[0]),
    ).toEqual(['OLDMAN-G02', 'OLDMAN-G01']);
  });

  it('says nothing about a safe command', () => {
    expect(runGuard(hookInput('Bash', 'git push -f origin feature/x'))).toEqual({
      status: 0,
      stdout: '',
      stderr: '',
    });
  });

  it.each([
    ['malformed JSON', '{"tool_name":'],
    [
      'a Write tool call',
      JSON.stringify({
        session_id: 's',
        cwd: '/',
        hook_event_name: 'PreToolUse',
        tool_name: 'Write',
        tool_input: { file_path: 'a', content: '' },
      }),
    ],
  ])('fails open on %s', (_name, stdin) => {
    expect(runGuard(stdin)).toEqual({
      status: 1,
      stdout: '',
      stderr: 'theoldman: invalid hook input\n',
    });
  });

  it('skips a rule listed in disable but still applies the others', () => {
    const configured = join(root, 'configured');
    mkdirSync(configured);
    writeFileSync(join(configured, '.theoldman.json'), JSON.stringify({ disable: ['OLDMAN-G01'] }));
    expect(runGuard(hookInput('Bash', 'git push -f origin main', configured)).stdout).toBe('');
    expect(denyReason(runGuard(hookInput('Bash', 'git push --no-verify', configured)))).toContain(
      'OLDMAN-G02',
    );
  });

  it('still blocks when .theoldman.json is invalid', () => {
    const broken = join(root, 'broken');
    mkdirSync(broken);
    writeFileSync(join(broken, '.theoldman.json'), '{ not json');
    expect(denyReason(runGuard(hookInput('Bash', 'git push -f origin main', broken)))).toContain(
      'OLDMAN-G01',
    );
  });

  it("reads the repo's default branch through git", () => {
    const repo = join(root, 'repo');
    mkdirSync(repo);
    execFileSync('git', ['init', '-q'], { cwd: repo });
    execFileSync(
      'git',
      ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/develop'],
      {
        cwd: repo,
      },
    );
    expect(denyReason(runGuard(hookInput('Bash', 'git push -f origin develop', repo)))).toContain(
      'force-pushing to develop',
    );
    expect(runGuard(hookInput('Bash', 'git push -f origin develop', project)).stdout).toBe('');
  });

  it('blocks a recursive delete outside the project and allows one inside', () => {
    expect(denyReason(runGuard(hookInput('Bash', 'rm -rf ../elsewhere')))).toContain('OLDMAN-G03');
    expect(runGuard(hookInput('Bash', 'rm -rf ./dist')).stdout).toBe('');
    expect(
      denyReason(runGuard(hookInput('PowerShell', 'Remove-Item -Recurse -Force ~'))),
    ).toContain('OLDMAN-G03');
  });

  it('uses CLAUDE_PROJECT_DIR as the project root when cwd is a subdirectory', () => {
    const sub = join(project, 'packages', 'web');
    mkdirSync(sub, { recursive: true });
    const env = { CLAUDE_PROJECT_DIR: project };
    expect(runGuard(hookInput('Bash', 'rm -rf ../api/dist', sub), env).stdout).toBe('');
    expect(denyReason(runGuard(hookInput('Bash', 'rm -rf ../api/dist', sub)))).toContain(
      'OLDMAN-G03',
    );
  });

  it('checks the package.json script that npm run would start, without running it', () => {
    const pkg = join(root, 'pkg');
    mkdirSync(join(pkg, 'src'), { recursive: true });
    const marker = join(pkg, 'ran.txt');
    writeFileSync(
      join(pkg, 'package.json'),
      JSON.stringify({
        scripts: {
          ship: `node -e "require('fs').writeFileSync('ran.txt','x')" && git push -f origin main`,
          release: 'npm run ship',
          build: 'tsc',
        },
      }),
    );
    expect(denyReason(runGuard(hookInput('Bash', 'npm run release', join(pkg, 'src'))))).toContain(
      'OLDMAN-G01',
    );
    expect(runGuard(hookInput('PowerShell', 'pnpm build', pkg)).stdout).toBe('');
    expect(existsSync(marker)).toBe(false);
  });

  it('checks a PowerShell -EncodedCommand', () => {
    const encoded = Buffer.from('git push -f origin main', 'utf16le').toString('base64');
    expect(denyReason(runGuard(hookInput('Bash', `pwsh -NoProfile -ec ${encoded}`)))).toContain(
      'OLDMAN-G01',
    );
  });

  it('reads DATABASE_URL from the environment, then from the project .env', () => {
    const app = join(root, 'app');
    mkdirSync(app);
    const reset = hookInput('Bash', 'npx prisma migrate reset', app);
    expect(denyReason(runGuard(reset))).toContain('no DATABASE_URL was found');
    writeFileSync(join(app, '.env'), 'DATABASE_URL="postgresql://localhost:5432/app"\n');
    expect(runGuard(reset).stdout).toBe('');
    const remote = { DATABASE_URL: 'postgresql://app@db.example.com/app' };
    expect(denyReason(runGuard(reset, remote))).toContain(
      'OLDMAN-G04: prisma migrate reset destroys data and the database is not local',
    );
  });
});
