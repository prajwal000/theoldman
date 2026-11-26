import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isRecord } from '../src/lib/input.js';

const pluginRoot = new URL('../../../plugin/', import.meta.url);
const hooksFile: unknown = JSON.parse(
  readFileSync(new URL('hooks/hooks.json', pluginRoot), 'utf8'),
);
const SCRIPT_ARG = /^\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/([a-z][a-z-]*\.mjs)$/;

interface Registration {
  readonly event: string;
  readonly matcher: unknown;
  readonly hook: unknown;
}

/** Every hook handler in hooks.json with the event and matcher it is registered under. */
function registrations(): Registration[] {
  const events = isRecord(hooksFile) && isRecord(hooksFile.hooks) ? hooksFile.hooks : {};
  return Object.entries(events).flatMap(([event, value]) => {
    const groups: unknown[] = Array.isArray(value) ? value : [];
    return groups.flatMap((group) => {
      const matcher = isRecord(group) ? group.matcher : undefined;
      const hooks: unknown[] = isRecord(group) && Array.isArray(group.hooks) ? group.hooks : [];
      return hooks.map((hook) => ({ event, matcher, hook }));
    });
  });
}

describe('plugin/hooks/hooks.json', () => {
  it('wraps the event map in a top-level hooks key', () => {
    expect(isRecord(hooksFile)).toBe(true);
    expect(Object.keys(hooksFile as object).sort()).toEqual(['description', 'hooks']);
    expect(registrations().length).toBeGreaterThan(0);
  });

  it('registers each script on its event, and the tool hooks on the tools they cover', () => {
    expect(
      registrations().map(({ event, matcher, hook }) => {
        const args: unknown[] = isRecord(hook) && Array.isArray(hook.args) ? hook.args : [];
        return [event, matcher, args[0]];
      }),
    ).toEqual([
      ['SessionStart', undefined, '${CLAUDE_PLUGIN_ROOT}/scripts/session-start.mjs'],
      ['PreToolUse', 'Bash|PowerShell', '${CLAUDE_PLUGIN_ROOT}/scripts/guard-bash.mjs'],
      ['PreToolUse', 'Write|Edit', '${CLAUDE_PLUGIN_ROOT}/scripts/guard-write.mjs'],
      ['PostToolUse', 'Write|Edit', '${CLAUDE_PLUGIN_ROOT}/scripts/check-file.mjs'],
    ]);
  });

  it.each(registrations().map((r) => [`${r.event} ${String(r.matcher)}`, r.hook] as const))(
    '%s runs node in exec form on one committed script, with a timeout',
    (_name, hook) => {
      expect(isRecord(hook)).toBe(true);
      const { type, command, args, timeout, shell, ...rest } = hook as Record<string, unknown>;
      expect({ type, command, shell, rest }).toEqual({
        type: 'command',
        command: 'node',
        shell: undefined,
        rest: {},
      });
      // One args element per value: no shell splits or quotes it, so paths with spaces work.
      expect(Array.isArray(args) && args.length === 1).toBe(true);
      const script = SCRIPT_ARG.exec(String((args as unknown[])[0]))?.[1];
      expect(script).toBeDefined();
      expect(existsSync(new URL(`scripts/${String(script)}`, pluginRoot))).toBe(true);
      expect(Number.isInteger(timeout) && Number(timeout) > 0 && Number(timeout) <= 60).toBe(true);
    },
  );
});
