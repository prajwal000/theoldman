import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { readDotenv } from '../../src/lib/dotenv.js';

describe('readDotenv', () => {
  const dir = mkdtempSync(join(tmpdir(), 'theoldman-dotenv-'));
  const file = join(dir, '.env');
  writeFileSync(
    file,
    [
      '# comment',
      'PLAIN=postgresql://localhost/app',
      'export EXPORTED=yes',
      'DOUBLE="has # hash"',
      "SINGLE='quoted value'",
      'TRAILING=value # note',
      '  SPACED = padded  ',
      'EMPTY=',
      'PLAIN=second wins? no, first match is used',
    ].join('\r\n'),
  );
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it.each([
    ['PLAIN', 'postgresql://localhost/app'],
    ['EXPORTED', 'yes'],
    ['DOUBLE', 'has # hash'],
    ['SINGLE', 'quoted value'],
    ['TRAILING', 'value'],
    ['SPACED', 'padded'],
    ['EMPTY', ''],
  ])('reads %s', (name, value) => {
    expect(readDotenv(file, name)).toBe(value);
  });

  it('returns undefined for a missing name or file', () => {
    expect(readDotenv(file, 'MISSING')).toBeUndefined();
    expect(readDotenv(join(dir, 'none.env'), 'PLAIN')).toBeUndefined();
  });
});
