import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadTask } from '../src/task.ts';

const TASKS = fileURLToPath(new URL('../tasks/', import.meta.url));
const ids = readdirSync(TASKS, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name !== '_template')
  .map((entry) => entry.name);

describe('the task list', () => {
  it('names every task in tasks/README.md, and nothing else', () => {
    const listed = [...readFileSync(join(TASKS, 'README.md'), 'utf8').matchAll(/^\| `([^`]+)`/gm)]
      .map((match) => match[1])
      .sort();
    expect(listed).toEqual([...ids].sort());
  });
});

describe.each(ids)('task %s', (id) => {
  const task = loadTask(TASKS, id);

  it('has a prompt, expected-behaviour notes and a hidden test file', () => {
    expect(task.prompt.length).toBeGreaterThan(100);
    expect(readFileSync(join(task.dir, 'expected.md'), 'utf8')).toMatch(/^# Expected behaviour/);
    const hidden = readdirSync(task.hiddenTestsDir, { recursive: true }).map(String);
    expect(hidden.some((path) => /\.hidden\.test\.tsx?$/.test(path))).toBe(true);
  });

  it('keeps hidden test names apart from the starter, so copying them in replaces nothing', () => {
    const hidden = readdirSync(task.hiddenTestsDir, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name).slice(task.hiddenTestsDir.length + 1));
    for (const path of hidden) {
      for (const dir of task.starterDirs) expect(existsSync(join(dir, path))).toBe(false);
    }
  });

  // The reference solution shows the hidden tests can pass; scoring it is a manual check, but it
  // must at least still apply to the starter as it is now.
  it('has a reference.patch that applies to the starter', () => {
    const work = mkdtempSync(join(tmpdir(), `theoldman-${id}-`));
    try {
      for (const dir of task.starterDirs) cpSync(dir, work, { recursive: true });
      const patch = join(task.dir, 'reference.patch');
      expect(() =>
        execFileSync('git', ['apply', '--check', '--whitespace=nowarn', patch], {
          cwd: work,
          stdio: 'pipe',
        }),
      ).not.toThrow();
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });
});
