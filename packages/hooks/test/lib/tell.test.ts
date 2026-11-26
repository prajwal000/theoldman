import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { readTellSections, TELL_FILE } from '../../src/lib/tell.js';

const repoPlugin = fileURLToPath(new URL('../../../../plugin/', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'theoldman-tell-'));
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function pluginWith(text: string): string {
  const root = mkdtempSync(join(scratch, 'plugin-'));
  mkdirSync(dirname(join(root, TELL_FILE)), { recursive: true });
  writeFileSync(join(root, TELL_FILE), text);
  return root;
}

describe('readTellSections', () => {
  it('returns the bullet lines under each heading and skips other text', () => {
    const root = pluginWith(
      [
        '# Title',
        '- not in a section',
        'Intro for maintainers.',
        '## core',
        '',
        '- one',
        '  - nested, skipped',
        'prose, skipped',
        '- two',
        '## db  ',
        '- three',
        '### not a section heading',
        '- four',
      ].join('\r\n'),
    );
    expect([...readTellSections(root)]).toEqual([
      ['core', ['- one', '- two']],
      ['db', ['- three', '- four']],
    ]);
  });

  it('throws when the file is missing, so the hook fails open', () => {
    expect(() => readTellSections(scratch)).toThrow();
  });
});

describe('the core rules in the oldman-rules skill', () => {
  const core = readTellSections(repoPlugin).get('core') ?? [];

  it('fit in a session-start summary under 40 lines', () => {
    expect(core.length).toBeGreaterThanOrEqual(8);
    expect(core.length + 2).toBeLessThan(40);
  });

  it('are one short line each', () => {
    for (const line of core) expect(line.length).toBeLessThanOrEqual(160);
  });
});
