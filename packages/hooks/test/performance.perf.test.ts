// Every speed check in one file. It runs in its own Vitest project after all other tests have
// finished (see vitest.config.ts), and the tests in one file run one after another, so nothing
// else competes for the CPU while it measures. Each check compares the median of SPEED_RUNS runs
// with the 300 ms limit.

import { describe, expect, it } from 'vitest';
import { diffAddedLines } from '../src/lib/added-lines.js';
import { extractComments } from '../src/lib/comments.js';
import type { Rule, RuleInput } from '../src/lib/rules.js';
import { c02, c03 } from '../src/rules/comment-code.js';
import { c06 } from '../src/rules/comment-density.js';
import { c01, c04, c05 } from '../src/rules/comments.js';
import { guardBashRule } from '../src/rules/guard-bash.js';
import { guardWriteRule } from '../src/rules/guard-write.js';
import { secretsRule } from '../src/rules/secrets.js';
import { assertFast, medianMs, SPEED_LIMIT_MS, SPEED_RUNS } from './harness.js';
import { fakeContext } from './rules/fake-context.js';
import { fillFakes } from './rules/fake-secrets.js';

const lines = (...items: string[]): string => items.map((item) => `${item}\n`).join('');

describe('medianMs', () => {
  it('returns the middle of the measured times', () => {
    const delays = [40, 0, 0, 40, 20];
    const median = medianMs(() => {
      const until = performance.now() + (delays.shift() ?? 0);
      while (performance.now() < until) {
        // Busy-wait for this run's delay.
      }
    });
    expect(median).toBeGreaterThanOrEqual(19);
    expect(median).toBeLessThan(40);
  });
});

describe('assertFast', () => {
  it(`runs the rule ${String(SPEED_RUNS)} times on 2,000 generated TypeScript lines, all added`, () => {
    const seen: RuleInput[] = [];
    const median = assertFast((input) => {
      seen.push(input);
      return [];
    });
    expect(median).toBeLessThan(SPEED_LIMIT_MS);
    expect(seen).toHaveLength(SPEED_RUNS);
    const [input] = seen;
    expect(input?.file).toBe('generated.ts');
    expect(input?.addedLines).toHaveLength(2000);
    expect(input?.addedLines.at(-1)?.line).toBe(2000);
    expect(input?.content.split('\n')).toHaveLength(2001);
    expect(input?.content).toContain('// Prisma returns null');
  });

  it('accepts a line generator and file name for other input', () => {
    let first = '';
    let file = '';
    assertFast(
      (input) => {
        first = input.addedLines[0]?.text ?? '';
        file = input.file;
        return [];
      },
      { generate: (index) => `git status # ${String(index)}`, file: 'commands.sh' },
    );
    expect([first, file]).toEqual(['git status # 0', 'commands.sh']);
  });

  it('fails a rule that takes 300 ms or more in most runs', () => {
    const slow: Rule = () => {
      const until = performance.now() + 320;
      while (performance.now() < until) {
        // Busy-wait: the point of this rule is to be slow.
      }
      return [];
    };
    expect(() => assertFast(slow)).toThrow(
      /rule took \d+\.\d ms \(median of 5 runs\) on 2,000 lines/,
    );
  });
});

describe('diffAddedLines on a 2,000-line file', () => {
  const before = Array.from({ length: 2000 }, (_, i) => `const value${String(i)} = ${String(i)};`);
  const block = before.slice(300, 1700);
  // The slowest change the exact diff still takes: 1,400 shared lines in a different order.
  const swappedBlock = [
    ...before.slice(0, 300),
    ...block.slice(700),
    ...block.slice(0, 700),
    ...before.slice(1700),
  ];

  it.each([
    ['a scattered edit', before.map((l, i) => (i % 7 === 0 ? `${l} // changed` : l)), 286],
    ['a full rewrite', before.map((l) => `${l} // rewritten`), 2000],
    ['every line reordered', before.toReversed(), 0],
    ['a reordered 1,400-line block', swappedBlock, 700],
  ])('diffs %s in under 300 ms', (_name, after, addedCount) => {
    let added: unknown[] = [];
    const median = medianMs(() => {
      added = diffAddedLines(lines(...before), lines(...after));
    });
    expect(added).toHaveLength(addedCount);
    expect(median).toBeLessThan(SPEED_LIMIT_MS);
  });
});

describe('extractComments on a 2,000-line file', () => {
  it('scans it in under 300 ms', () => {
    const sample = [
      "import { readFileSync } from 'node:fs';",
      '// Prisma returns null for soft-deleted rows (see #214).',
      "const url = 'https://example.com/api?q=' + encodeURIComponent(id); // not a comment start",
      'const re = /\\/\\/[a-z]+/g;',
      '/** Exported helper. */',
      'export const label = `user ${name} // inside a template`;',
    ];
    const source = Array.from({ length: 2000 }, (_, i) => sample[i % sample.length]).join('\n');
    let count = 0;
    const median = medianMs(() => {
      count = extractComments(source).length;
    });
    expect(count).toBeGreaterThan(900);
    expect(median).toBeLessThan(SPEED_LIMIT_MS);
  });
});

describe('comment rules on 2,000 lines', () => {
  it.each([
    ['OLDMAN-C01', c01],
    ['OLDMAN-C02', c02],
    ['OLDMAN-C03', c03],
    ['OLDMAN-C04', c04],
    ['OLDMAN-C05', c05],
    ['OLDMAN-C06', c06],
  ])('%s', (_id, rule) => {
    assertFast(rule);
  });
});

describe('guard rules on 2,000 lines', () => {
  it('guard-bash', () => {
    const commands = [
      'git push -f origin main',
      'npm test && git commit -m "x" --no-verify',
      '$env:FOO=1; git push --force origin master',
      'echo "git push -f origin main" | tee log.txt',
      'rm -rf ./dist /etc && Remove-Item -Recurse -Force ..\\other',
      'DATABASE_URL=postgresql://localhost/app npx prisma migrate reset && psql -c "DROP TABLE t"',
    ];
    assertFast(guardBashRule(fakeContext().context), {
      generate: (index) => commands[index % commands.length] ?? '',
      file: 'commands.sh',
    });
  });

  it('guard-write', () => {
    const paths = ['src/a.ts', 'apps/web/.env.local', 'C:\\keys\\server.key', '.env.example'];
    assertFast(guardWriteRule(), {
      generate: (i) => paths[i % paths.length] ?? '',
      file: 'paths.txt',
    });
  });

  it('secrets', () => {
    const sample = [
      fillFakes("const s = new Stripe('{{fake:stripe-live}}');"),
      'export const apiKey = process.env.API_KEY;',
      fillFakes('SESSION_SECRET={{fake:high-entropy}}'),
      'const value = compute(a, b) + 42; // ordinary code with = and : signs',
    ];
    assertFast(secretsRule(), { generate: (i) => sample[i % sample.length] ?? '' });
  });
});
