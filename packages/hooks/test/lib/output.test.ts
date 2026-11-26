import { closeSync, mkdtempSync, openSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, expectTypeOf, it } from 'vitest';
import { readToolHookInput } from '../../src/lib/input.js';
import {
  block,
  failOpen,
  fix,
  formatFindings,
  type HookEvent,
  type HookIo,
  notify,
  pass,
  runHook,
  say,
  warn,
  writeOutput,
} from '../../src/lib/output.js';

function fakeIo(): { io: HookIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  const io: HookIo = {
    stdout: {
      write: (chunk) => {
        out.push(chunk);
        return true;
      },
    },
    stderr: {
      write: (chunk) => {
        err.push(chunk);
        return true;
      },
    },
  };
  return { io, out, err };
}

describe('pass', () => {
  it('exits 0 with no output', () => {
    expect(pass()).toEqual({ exitCode: 0, stdout: '', stderr: '' });
  });
});

describe('block', () => {
  it('denies a PreToolUse call with the reason', () => {
    const output = block('OLDMAN-G05 .env:1 Do not edit .env files.');
    expect(output.exitCode).toBe(0);
    expect(output.stderr).toBe('');
    expect(JSON.parse(output.stdout)).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'OLDMAN-G05 .env:1 Do not edit .env files.',
      },
    });
  });
});

describe('fix', () => {
  it.each(['PostToolUse', 'Stop'] as const)('asks for a fix on %s', (event) => {
    expect(JSON.parse(fix(event, 'Remove the narration comment.').stdout)).toEqual({
      decision: 'block',
      reason: 'Remove the narration comment.',
    });
  });

  it('adds warnings as additionalContext for the same event', () => {
    expect(JSON.parse(fix('PostToolUse', 'Fix this.', 'Also note that.').stdout)).toEqual({
      decision: 'block',
      reason: 'Fix this.',
      hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: 'Also note that.' },
    });
  });

  it('takes no context on Stop, where additionalContext forces another turn', () => {
    // @ts-expect-error -- the Stop overload has no context parameter.
    const output = fix('Stop', 'Fix this.', 'Also note that.');
    expect(output.stdout).toContain('additionalContext');
  });
});

describe('say', () => {
  it('prints one line of plain text and exits 0', () => {
    expect(say('Paused.')).toEqual({ exitCode: 0, stdout: 'Paused.\n', stderr: '' });
  });
});

describe('notify', () => {
  it('sends a systemMessage for the user only', () => {
    const output = notify('Review skipped.');
    expect(output.exitCode).toBe(0);
    expect(JSON.parse(output.stdout)).toEqual({ systemMessage: 'Review skipped.' });
  });
});

describe('warn', () => {
  const events = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse'] as const;

  it('is not offered for Stop, where additionalContext forces another turn', () => {
    expectTypeOf(warn).parameter(0).toEqualTypeOf<Exclude<HookEvent, 'Stop'>>();
  });

  it.each(events)('adds context on %s without blocking', (event) => {
    const output = warn(event, 'Heads up.');
    expect(output.exitCode).toBe(0);
    expect(JSON.parse(output.stdout)).toEqual({
      hookSpecificOutput: { hookEventName: event, additionalContext: 'Heads up.' },
    });
  });
});

describe('failOpen', () => {
  it('exits 1 with a short stderr message and no stdout', () => {
    expect(failOpen('invalid hook input')).toEqual({
      exitCode: 1,
      stdout: '',
      stderr: 'theoldman: invalid hook input\n',
    });
  });
});

describe('formatFindings', () => {
  it('prints rule ID, file, line and message, one finding per line', () => {
    expect(
      formatFindings([
        { id: 'OLDMAN-C01', action: 'fix', file: 'src/a.ts', line: 3, message: 'Narration.' },
        { id: 'OLDMAN-S01', action: 'block', file: 'C:\\p\\b.ts', line: 10, message: 'Secret.' },
      ]),
    ).toBe('OLDMAN-C01 src/a.ts:3 Narration.\nOLDMAN-S01 C:\\p\\b.ts:10 Secret.');
  });
});

describe('writeOutput', () => {
  it('writes only non-empty streams and sets the exit code', () => {
    const json = fakeIo();
    writeOutput(warn('PostToolUse', 'x'), json.io);
    expect(json.out).toHaveLength(1);
    expect(json.err).toEqual([]);
    expect(json.io.exitCode).toBe(0);

    const error = fakeIo();
    writeOutput(failOpen('boom'), error.io);
    expect(error.out).toEqual([]);
    expect(error.err).toEqual(['theoldman: boom\n']);
    expect(error.io.exitCode).toBe(1);
  });
});

describe('runHook', () => {
  it('writes what the handler returns', () => {
    const { io, out } = fakeIo();
    runHook(() => block('no'), io);
    expect(out).toEqual([block('no').stdout]);
    expect(io.exitCode).toBe(0);
  });

  it('fails open when the handler throws an Error', () => {
    const { io, out, err } = fakeIo();
    runHook(() => {
      throw new Error('disk full');
    }, io);
    expect(out).toEqual([]);
    expect(err).toEqual(['theoldman: internal error: disk full\n']);
    expect(io.exitCode).toBe(1);
  });

  it('fails open when the handler throws a non-Error value', () => {
    const { io, err } = fakeIo();
    runHook(() => {
      // Third-party code can throw anything; runHook must still fail open.
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw 'oops';
    }, io);
    expect(err).toEqual(['theoldman: internal error: oops\n']);
    expect(io.exitCode).toBe(1);
  });

  describe('with stdin that the type guards reject', () => {
    const dir = mkdtempSync(join(tmpdir(), 'theoldman-output-'));
    afterAll(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    it.each([
      ['malformed JSON', '{"tool_name":'],
      [
        'an unsupported tool',
        '{"session_id":"s","cwd":"/","hook_event_name":"x","tool_name":"Read"}',
      ],
    ])('fails open on %s', (_name, stdin) => {
      const file = join(dir, 'stdin.json');
      writeFileSync(file, stdin);
      const fd = openSync(file, 'r');
      const { io, out, err } = fakeIo();
      try {
        runHook(() => {
          const input = readToolHookInput(fd);
          return input === undefined ? failOpen('invalid hook input') : block('unexpected');
        }, io);
      } finally {
        closeSync(fd);
      }
      expect(out).toEqual([]);
      expect(err).toEqual(['theoldman: invalid hook input\n']);
      expect(io.exitCode).toBe(1);
    });
  });
});
