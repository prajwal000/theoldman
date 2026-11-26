import { describe, expect, it } from 'vitest';
import { checkPath, guardWriteRule } from '../../src/rules/guard-write.js';
import { assertFast, runRuleOnFixtures } from '../harness.js';

runRuleOnFixtures('OLDMAN-G05', guardWriteRule());
runRuleOnFixtures('OLDMAN-G06', guardWriteRule());

describe('checkPath', () => {
  it('names the rule, the path and the safe alternative', () => {
    expect(checkPath('apps\\web\\.env')).toEqual({
      id: 'OLDMAN-G05',
      message:
        'apps\\web\\.env is an env file and can hold real secrets. Add the variable name to .env.example instead, and ask the user to put the value in their own env file.',
    });
    expect(checkPath('C:\\Users\\me\\.ssh\\id_rsa')?.message).toContain(
      'Do not create or change key files; ask the user to manage them.',
    );
  });

  it('allows ordinary files and an empty path', () => {
    expect(checkPath('src/index.ts')).toBeUndefined();
    expect(checkPath('')).toBeUndefined();
  });

  it('skips blank lines in fixtures', () => {
    const rule = guardWriteRule();
    expect(rule({ file: 'x.txt', content: '\n', addedLines: [{ line: 1, text: '  ' }] })).toEqual(
      [],
    );
  });

  it('is fast on 2,000 paths', () => {
    const paths = ['src/a.ts', 'apps/web/.env.local', 'C:\\keys\\server.key', '.env.example'];
    assertFast(guardWriteRule(), {
      generate: (i) => paths[i % paths.length] ?? '',
      file: 'paths.txt',
    });
  });
});
