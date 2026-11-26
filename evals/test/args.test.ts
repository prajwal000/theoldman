import { describe, expect, it } from 'vitest';
import { DEFAULT_RUNS, MAX_RUNS, parseRunArgs } from '../src/args.ts';
import { ConfigError } from '../src/errors.ts';

const base = ['--task', '_template', '--condition', 'with'];

describe('parseRunArgs', () => {
  it('parses the full command line', () => {
    expect(
      parseRunArgs(['--task', 'auth-reset', '--condition', 'without', '--runs', '1', '--dry-run']),
    ).toEqual({ task: 'auth-reset', condition: 'without', runs: 1, dryRun: true, publish: false });
  });

  it('defaults to three runs, a real run and no publication', () => {
    expect(parseRunArgs(base)).toEqual({
      task: '_template',
      condition: 'with',
      runs: DEFAULT_RUNS,
      dryRun: false,
      publish: false,
    });
  });

  it('accepts --publish and a leading -- separator from pnpm', () => {
    expect(parseRunArgs(['--', ...base, '--publish'])).toMatchObject({ publish: true });
  });

  it('returns undefined for --help', () => {
    expect(parseRunArgs(['--help'])).toBeUndefined();
  });

  it.each([
    [[], '--task is required'],
    [['--task', '_template'], '--condition must be "with" or "without"'],
    [['--task', '_template', '--condition', 'both'], '--condition must be "with" or "without"'],
    [[...base, '--runs', '0'], '--runs must be a whole number'],
    [[...base, '--runs', String(MAX_RUNS + 1)], '--runs must be a whole number'],
    [[...base, '--runs', '2.5'], '--runs must be a whole number'],
    [[...base, '--runs', 'three'], '--runs must be a whole number'],
    [[...base, '--model', 'sonnet'], "Unknown option '--model'"],
    [[...base, 'extra'], 'extra'],
  ])('rejects %j', (argv, message) => {
    expect(() => parseRunArgs(argv)).toThrow(ConfigError);
    expect(() => parseRunArgs(argv)).toThrow(message);
  });

  it.each(['../secrets', 'a/b', 'a\\b', 'Template', '.hidden', ''])(
    'rejects the task ID %j, which could leave the tasks folder',
    (task) => {
      expect(() => parseRunArgs(['--task', task, '--condition', 'with'])).toThrow(ConfigError);
    },
  );
});
