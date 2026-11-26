import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildHooks } from '../../build.mjs';
import { setPaused } from '../../src/lib/state.js';

const root = mkdtempSync(join(tmpdir(), 'theoldman-session-start-'));
// The script finds the skills next to its own folder, as in the installed plugin.
const plugin = join(root, 'plugin');
const bare = join(root, 'bare');

beforeAll(async () => {
  await buildHooks({ outDir: join(plugin, 'scripts') });
  cpSync(
    fileURLToPath(new URL('../../../../plugin/skills', import.meta.url)),
    join(plugin, 'skills'),
    {
      recursive: true,
    },
  );
  await buildHooks({ outDir: join(bare, 'scripts') });
});
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

let projects = 0;
function newProject(files: Record<string, string> = {}): string {
  projects += 1;
  const dir = join(root, `project-${String(projects)}`);
  mkdirSync(dir);
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}

function runStart(project: string, stdin?: string, pluginDir = plugin) {
  const inherited = { ...process.env };
  delete inherited.CLAUDE_PROJECT_DIR;
  const input = {
    session_id: 's1',
    cwd: project,
    hook_event_name: 'SessionStart',
    source: 'startup',
  };
  const result = spawnSync(process.execPath, [join(pluginDir, 'scripts', 'session-start.mjs')], {
    input: stdin ?? JSON.stringify(input),
    encoding: 'utf8',
    env: { ...inherited, CLAUDE_PROJECT_DIR: project },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function context(run: ReturnType<typeof runStart>): string[] {
  expect(run).toMatchObject({ status: 0, stderr: '' });
  const output = JSON.parse(run.stdout) as { hookSpecificOutput: Record<string, unknown> };
  expect(Object.keys(output)).toEqual(['hookSpecificOutput']);
  expect(output.hookSpecificOutput.hookEventName).toBe('SessionStart');
  return String(output.hookSpecificOutput.additionalContext).split('\n');
}

const pkg = JSON.stringify({
  dependencies: { next: '15.0.0', react: '19.0.0', '@prisma/client': '6.0.0' },
  devDependencies: { typescript: '5.0.0', vitest: '3.0.0' },
});

describe('session-start hook', () => {
  it('gives Claude the core rules and the stack from package.json, in under 40 lines', () => {
    const lines = context(runStart(newProject({ 'package.json': pkg })));
    expect(lines[0]).toBe('theoldman core rules (the oldman-rules skill has the full text):');
    expect(lines.slice(1, -1).every((line) => line.startsWith('- '))).toBe(true);
    expect(lines.join('\n')).toContain('Comments say why, never what.');
    expect(lines.at(-1)).toBe(
      'Stack (from package.json): typescript, nextjs, react, prisma, vitest.',
    );
    expect(lines.length).toBeLessThan(40);
  });

  it('prefers the stack set in .theoldman.json, and says when nothing is detected', () => {
    const configured = newProject({
      'package.json': pkg,
      '.theoldman.json': JSON.stringify({ stack: ['python', 'django'] }),
    });
    expect(context(runStart(configured)).at(-1)).toBe(
      'Stack (from .theoldman.json): python, django.',
    );
    expect(context(runStart(newProject())).at(-1)).toBe(
      'Stack: nothing detected from package.json.',
    );
  });

  it('prints only a one-line notice at level quick', () => {
    const project = newProject({ '.theoldman.json': JSON.stringify({ level: 'quick' }) });
    expect(context(runStart(project))).toEqual([
      'theoldman level is quick: guards and edit checks are on, the rules summary and review are off.',
    ]);
  });

  it('prints only a one-line notice while paused', () => {
    const project = newProject();
    setPaused(project, true);
    expect(context(runStart(project))).toEqual([
      'theoldman is paused: the guards stay on; rules, checks and review are off.',
    ]);
  });

  it('reports an unusable config before the rules', () => {
    const lines = context(runStart(newProject({ '.theoldman.json': '{' })));
    expect(lines[0]).toBe('theoldman: .theoldman.json is not valid JSON; using defaults.');
    expect(lines[1]).toMatch(/^theoldman core rules/);
  });

  it('fails open on invalid input or when the rules file is missing', () => {
    const project = newProject();
    expect(runStart(project, '{"hook_event_name": "SessionStart"}')).toEqual({
      status: 1,
      stdout: '',
      stderr: 'theoldman: invalid hook input\n',
    });
    const missing = runStart(project, undefined, bare);
    expect(missing.status).toBe(1);
    expect(missing.stdout).toBe('');
    expect(missing.stderr).toMatch(/^theoldman: /);
  });
});
