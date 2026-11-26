import { closeSync, mkdtempSync, openSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  isCommonInput,
  isEditToolInput,
  isPromptHookInput,
  isShellToolInput,
  isToolHookInput,
  isWriteToolInput,
  parseJson,
  readHookInput,
  readToolHookInput,
} from '../../src/lib/input.js';

const common = { session_id: 's1', cwd: 'C:\\project dir', hook_event_name: 'PreToolUse' };

const valid = {
  bash: { ...common, tool_name: 'Bash', tool_input: { command: 'git status' } },
  powershell: { ...common, tool_name: 'PowerShell', tool_input: { command: 'Get-ChildItem' } },
  write: {
    ...common,
    tool_name: 'Write',
    tool_input: { file_path: 'C:\\project dir\\a.ts', content: 'x' },
  },
  edit: {
    ...common,
    tool_name: 'Edit',
    tool_input: { file_path: '/c/project/a.ts', old_string: 'a', new_string: 'b' },
  },
  editReplaceAll: {
    ...common,
    tool_name: 'Edit',
    tool_input: { file_path: 'a.ts', old_string: 'a', new_string: 'b', replace_all: true },
  },
};

describe('isToolHookInput', () => {
  it.each(Object.entries(valid))('accepts %s input', (_name, input) => {
    expect(isToolHookInput(input)).toBe(true);
  });

  it.each([
    ['null', null],
    ['an array', [valid.bash]],
    ['a string', 'git status'],
    ['missing session_id', { ...valid.bash, session_id: undefined }],
    ['non-string cwd', { ...valid.bash, cwd: 42 }],
    ['missing hook_event_name', { ...valid.bash, hook_event_name: undefined }],
    ['an unsupported tool', { ...common, tool_name: 'Read', tool_input: { file_path: 'a.ts' } }],
    ['missing tool_input', { ...common, tool_name: 'Bash' }],
    ['Bash with a non-string command', { ...valid.bash, tool_input: { command: ['rm'] } }],
    ['Write without content', { ...valid.write, tool_input: { file_path: 'a.ts' } }],
    [
      'Edit with a non-boolean replace_all',
      { ...valid.edit, tool_input: { ...valid.edit.tool_input, replace_all: 'yes' } },
    ],
  ])('rejects %s', (_name, input) => {
    expect(isToolHookInput(input)).toBe(false);
  });
});

describe('tool input guards', () => {
  it('check only the fields each tool needs', () => {
    expect(isShellToolInput({ command: 'ls', description: 'list' })).toBe(true);
    expect(isShellToolInput({})).toBe(false);
    expect(isWriteToolInput({ file_path: 'a', content: '' })).toBe(true);
    expect(isWriteToolInput({ file_path: 1, content: '' })).toBe(false);
    expect(isEditToolInput({ file_path: 'a', old_string: 'x', new_string: 'y' })).toBe(true);
    expect(isEditToolInput({ file_path: 'a', old_string: 'x' })).toBe(false);
    expect(isEditToolInput(null)).toBe(false);
  });
});

describe('event input guards', () => {
  it('accept the common fields alone, and a prompt only as a string', () => {
    const start = { ...common, hook_event_name: 'SessionStart', source: 'startup' };
    expect(isCommonInput(start)).toBe(true);
    expect(isCommonInput({ ...start, cwd: undefined })).toBe(false);
    expect(isPromptHookInput({ ...common, prompt: 'fix the login bug' })).toBe(true);
    expect(isPromptHookInput({ ...common, prompt: ['x'] })).toBe(false);
    expect(isPromptHookInput(start)).toBe(false);
  });
});

describe('parseJson', () => {
  it('returns parsed JSON or undefined for malformed text', () => {
    expect(parseJson('{"a":1}')).toEqual({ a: 1 });
    expect(parseJson('\uFEFF{"a":1}\r\n')).toEqual({ a: 1 });
    expect(parseJson('{not json')).toBeUndefined();
    expect(parseJson('')).toBeUndefined();
  });
});

describe('readToolHookInput', () => {
  const dir = mkdtempSync(join(tmpdir(), 'theoldman-input-'));
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function readFrom(text: string): unknown {
    const file = join(dir, 'stdin.json');
    writeFileSync(file, text);
    const fd = openSync(file, 'r');
    try {
      return readToolHookInput(fd);
    } finally {
      closeSync(fd);
    }
  }

  it('returns valid input', () => {
    expect(readFrom(JSON.stringify(valid.write))).toEqual(valid.write);
  });

  it('returns undefined for malformed JSON', () => {
    expect(readFrom('{"tool_name": "Bash"')).toBeUndefined();
  });

  it('returns undefined for well-formed JSON of the wrong shape', () => {
    expect(readFrom(JSON.stringify({ ...common, tool_name: 'Bash', tool_input: {} }))).toBe(
      undefined,
    );
  });

  it('reads other events with the guard it is given', () => {
    const file = join(dir, 'prompt.json');
    const prompt = { ...common, hook_event_name: 'UserPromptSubmit', prompt: 'hi' };
    writeFileSync(file, JSON.stringify(prompt));
    const fd = openSync(file, 'r');
    try {
      expect(readHookInput(isPromptHookInput, fd)).toEqual(prompt);
    } finally {
      closeSync(fd);
    }
  });
});
