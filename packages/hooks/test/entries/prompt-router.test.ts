import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildHooks } from '../../build.mjs';
import { setPaused } from '../../src/lib/state.js';

const root = mkdtempSync(join(tmpdir(), 'theoldman-prompt-router-'));
// The script finds the skills next to its own folder, as in the installed plugin.
const plugin = join(root, 'plugin');
const bare = join(root, 'bare');
// tell.md exists but cannot be read as a file, or has no section for the prompt's category.
const unreadable = join(root, 'unreadable');
const empty = join(root, 'empty');
const project = join(root, 'project');

beforeAll(async () => {
  await buildHooks({ outDir: join(plugin, 'scripts') });
  cpSync(
    fileURLToPath(new URL('../../../../plugin/skills', import.meta.url)),
    join(plugin, 'skills'),
    {
      recursive: true,
    },
  );
  for (const dir of [bare, unreadable, empty]) await buildHooks({ outDir: join(dir, 'scripts') });
  mkdirSync(join(unreadable, 'skills', 'oldman-rules', 'tell.md'), { recursive: true });
  mkdirSync(join(empty, 'skills', 'oldman-rules'), { recursive: true });
  writeFileSync(join(empty, 'skills', 'oldman-rules', 'tell.md'), '# Title\n\n## core\n\n- x\n');
  mkdirSync(project);
});
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function runRouter(prompt: unknown, dir = project, pluginDir = plugin) {
  const inherited = { ...process.env };
  delete inherited.CLAUDE_PROJECT_DIR;
  const input = { session_id: 's1', cwd: dir, hook_event_name: 'UserPromptSubmit', prompt };
  const result = spawnSync(process.execPath, [join(pluginDir, 'scripts', 'prompt-router.mjs')], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...inherited, CLAUDE_PROJECT_DIR: dir },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function context(run: ReturnType<typeof runRouter>): string[] {
  expect(run).toMatchObject({ status: 0, stderr: '' });
  const output = JSON.parse(run.stdout) as { hookSpecificOutput: Record<string, unknown> };
  expect(output.hookSpecificOutput.hookEventName).toBe('UserPromptSubmit');
  return String(output.hookSpecificOutput.additionalContext).split('\n');
}

const silent = { status: 0, stdout: '', stderr: '' };

describe('prompt-router hook', () => {
  it('adds at most four rule lines for the top two categories', () => {
    const lines = context(runRouter('Add a POST endpoint that saves the order to the database'));
    expect(lines[0]).toBe('theoldman rules for this prompt (api, db):');
    expect(lines.slice(1)).toHaveLength(4);
    expect(lines[1]).toMatch(/^- Validate the body/);
    expect(lines[2]).toMatch(/^- Migrations are backward compatible/);
  });

  it('uses up to four lines of a single category', () => {
    const lines = context(runRouter('This Prisma query is slow, add an index'));
    expect(lines[0]).toBe('theoldman rules for this prompt (db):');
    expect(lines.slice(1)).toHaveLength(4);
  });

  it('says nothing for a trivial prompt or while paused', () => {
    expect(runRouter('Thanks, that looks good')).toEqual(silent);
    const paused = join(root, 'paused');
    mkdirSync(paused);
    setPaused(paused, true);
    expect(runRouter('Add tests for the parser', paused)).toEqual(silent);
  });

  it('fails open on invalid input', () => {
    expect(runRouter(42)).toEqual({
      status: 1,
      stdout: '',
      stderr: 'theoldman: invalid hook input\n',
    });
  });

  // Exit 1 is a non-blocking error: the prompt goes through unchanged, nothing is added to
  // Claude's context, and only one short line goes to stderr.
  it.each([
    ['missing', bare],
    ['unreadable', unreadable],
    ['without a section for the category', empty],
  ])('fails open, adding no context, when tell.md is %s', (_name, pluginDir) => {
    const run = runRouter('Add tests for the parser', project, pluginDir);
    expect(run.status).toBe(1);
    expect(run.stdout).toBe('');
    expect(run.stderr).toMatch(/^theoldman: [^\n]+\n$/);
  });
});
