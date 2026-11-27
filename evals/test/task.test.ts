import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigError } from '../src/errors.ts';
import { folderHash, loadTask } from '../src/task.ts';

const TASKS = fileURLToPath(new URL('../tasks/', import.meta.url));

describe('loadTask on the committed template', () => {
  it('loads _template', () => {
    const task = loadTask(TASKS, '_template');
    expect(task).toMatchObject({
      id: '_template',
      title: 'Template: add a clamp function',
      timeoutMinutes: 15,
      services: [],
    });
    expect(task.prompt).toMatch(/^Add a `clamp\(value, min, max\)` function/);
    expect(task.starterDir).toBe(join(TASKS, '_template', 'starter'));
    expect(task.hiddenTestsDir).toBe(join(TASKS, '_template', 'hidden'));
  });
});

describe('folderHash', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'theoldman-hash-'));
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'a.ts'), 'a\n');
    writeFileSync(join(dir, 'b.json'), '{}\n');
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('is stable and changes with any path or content', () => {
    const first = folderHash(dir);
    expect(first).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(folderHash(dir)).toBe(first);
    writeFileSync(join(dir, 'src', 'a.ts'), 'a changed\n');
    const edited = folderHash(dir);
    expect(edited).not.toBe(first);
    writeFileSync(join(dir, 'src', 'c.ts'), '');
    expect(folderHash(dir)).not.toBe(edited);
  });
});

describe('loadTask validation', () => {
  let tasks: string;
  let dir: string;
  const valid = {
    title: 'Sample',
    starter: 'starter',
    hiddenTests: 'hidden',
    timeoutMinutes: 10,
  };

  beforeEach(() => {
    tasks = mkdtempSync(join(tmpdir(), 'theoldman-tasks-'));
    dir = join(tasks, 'sample');
    mkdirSync(join(dir, 'starter'), { recursive: true });
    mkdirSync(join(dir, 'hidden'));
    writeFileSync(join(dir, 'hidden', 'a.test.ts'), '');
    writeFileSync(join(dir, 'prompt.md'), 'Do the thing.\n');
    writeTask(valid);
  });
  afterEach(() => {
    rmSync(tasks, { recursive: true, force: true });
  });

  function writeTask(json: unknown): void {
    writeFileSync(join(dir, 'task.json'), JSON.stringify(json));
  }

  function failure(): string {
    try {
      loadTask(tasks, 'sample');
    } catch (error) {
      if (error instanceof ConfigError) return error.message;
      throw error;
    }
    throw new Error('expected a ConfigError');
  }

  it('loads a valid task, with no services by default', () => {
    expect(loadTask(tasks, 'sample')).toMatchObject({ title: 'Sample', services: [] });
  });

  it('accepts the postgres service', () => {
    writeTask({ ...valid, services: ['postgres'] });
    expect(loadTask(tasks, 'sample').services).toEqual(['postgres']);
  });

  it('names a missing task folder', () => {
    expect(() => loadTask(tasks, 'nope')).toThrow('Task "nope" not found');
  });

  it('names a missing or broken task.json', () => {
    rmSync(join(dir, 'task.json'));
    expect(failure()).toBe('sample/task.json is missing.');
    writeFileSync(join(dir, 'task.json'), '{ not json');
    expect(failure()).toMatch(/^sample\/task.json is not valid JSON/);
    writeTask(['a list']);
    expect(failure()).toBe('sample/task.json must hold a JSON object.');
  });

  it.each([
    [{ ...valid, extra: 1 }, 'unknown field extra'],
    [{ ...valid, title: ' ' }, '"title" must be a non-empty string'],
    [{ ...valid, timeoutMinutes: 0 }, '"timeoutMinutes" must be a whole number'],
    [{ ...valid, timeoutMinutes: 61 }, '"timeoutMinutes" must be a whole number'],
    [{ ...valid, timeoutMinutes: '10' }, '"timeoutMinutes" must be a whole number'],
    [{ ...valid, services: ['redis'] }, '"services" must be a list of: postgres'],
    [{ ...valid, services: 'postgres' }, '"services" must be a list of: postgres'],
    [{ ...valid, starter: '' }, '"starter" must name a folder in the task'],
    [{ ...valid, starter: '../other' }, '"starter" must be a folder inside the task'],
    [{ ...valid, starter: '.' }, '"starter" must be a folder inside the task'],
    [{ ...valid, hiddenTests: tmpdir() }, '"hiddenTests" must be a folder inside the task'],
    [{ ...valid, starter: 'missing' }, '"starter" folder "missing" does not exist'],
    [{ ...valid, hiddenTests: 'prompt.md' }, '"hiddenTests" folder "prompt.md" does not exist'],
  ])('rejects %j', (json, message) => {
    writeTask(json);
    expect(failure()).toContain(message);
  });

  it('keeps the hidden tests out of the starter', () => {
    mkdirSync(join(dir, 'starter', 'hidden'));
    writeFileSync(join(dir, 'starter', 'hidden', 'a.test.ts'), '');
    writeTask({ ...valid, hiddenTests: 'starter/hidden' });
    expect(failure()).toContain('must be separate folders, so the hidden tests stay hidden');
    writeTask({ ...valid, hiddenTests: 'starter' });
    expect(failure()).toContain('must be separate folders');
  });

  it('needs at least one hidden test file', () => {
    rmSync(join(dir, 'hidden', 'a.test.ts'));
    expect(failure()).toContain('the "hiddenTests" folder is empty');
  });

  it('needs a non-empty prompt', () => {
    writeFileSync(join(dir, 'prompt.md'), '  \n');
    expect(failure()).toBe('sample/prompt.md is empty.');
    rmSync(join(dir, 'prompt.md'));
    expect(failure()).toBe('sample/prompt.md is missing.');
  });
});
