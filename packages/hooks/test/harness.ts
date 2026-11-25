import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { splitLines } from '../src/lib/added-lines.js';
import type { Rule, RuleInput } from '../src/lib/rules.js';

export const FIXTURES_ROOT = fileURLToPath(new URL('./fixtures/', import.meta.url));

// `// expect: OLDMAN-C01@3, OLDMAN-C01@7`, also with `#`, `--` or `/* ... */` for other languages.
const EXPECT_LINE = /^\s*(?:\/\/|#|--|\/\*)\s*expect:(.*?)(?:\*\/)?\s*$/;
const EXPECTATION = /^(OLDMAN-[A-Z]\d{2})@([1-9]\d*)$/;

export type FixtureKind = 'bad' | 'good';

export interface Fixture {
  readonly kind: FixtureKind;
  /** Path below `bad/` or `good/`, with forward slashes; rules see it as the file path. */
  readonly file: string;
  readonly input: RuleInput;
  /** Expected findings as sorted `ID@line` strings. */
  readonly expected: readonly string[];
}

/**
 * Parses one fixture. `expect:` header lines are replaced by empty lines before the rule sees
 * the file, so line numbers stay true but the header cannot trigger comment rules.
 */
export function parseFixture(
  ruleId: string,
  kind: FixtureKind,
  file: string,
  text: string,
): Fixture {
  const expected: string[] = [];
  const lines = text.replaceAll('\r\n', '\n').split('\n');
  lines.forEach((line, index) => {
    const header = EXPECT_LINE.exec(line);
    if (header === null) return;
    for (const token of (header[1] ?? '').split(/[\s,]+/).filter(Boolean)) {
      const match = EXPECTATION.exec(token);
      if (match === null) throw new Error(`${kind}/${file}: "${token}" is not ID@line`);
      if (match[1] !== ruleId) throw new Error(`${kind}/${file}: expects ${token}, not ${ruleId}`);
      expected.push(token);
    }
    lines[index] = '';
  });
  if (kind === 'bad' && expected.length === 0) {
    throw new Error(`bad/${file}: declares no expected findings`);
  }
  if (kind === 'good' && expected.length > 0) {
    throw new Error(`good/${file}: a good fixture cannot expect findings`);
  }
  const content = lines.join('\n');
  const addedLines = splitLines(content).map((lineText, index) => ({
    line: index + 1,
    text: lineText,
  }));
  return { kind, file, input: { file, content, addedLines }, expected: expected.sort() };
}

function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      join(entry.parentPath, entry.name)
        .slice(dir.length + 1)
        .replaceAll('\\', '/'),
    )
    .sort();
}

/** Loads `<root>/<ruleId>/bad/**` and `good/**`. Every rule needs at least one of each. */
export function loadFixtures(ruleId: string, root = FIXTURES_ROOT): Fixture[] {
  return (['bad', 'good'] as const).flatMap((kind) => {
    const dir = join(root, ruleId, kind);
    const files = listFiles(dir);
    if (files.length === 0)
      throw new Error(`${ruleId} needs at least one ${kind} fixture in ${dir}`);
    return files.map((file) =>
      parseFixture(ruleId, kind, file, readFileSync(join(dir, file), 'utf8')),
    );
  });
}

/** How the rule's findings for its own ID differ from what the fixture expects; empty if none. */
export function fixtureProblems(ruleId: string, rule: Rule, fixture: Fixture): string[] {
  const findings = rule(fixture.input).filter((finding) => finding.id === ruleId);
  const actual = findings.map((finding) => `${finding.id}@${String(finding.line)}`);
  return [
    ...fixture.expected.filter((key) => !actual.includes(key)).map((key) => `missing ${key}`),
    ...actual.filter((key) => !fixture.expected.includes(key)).map((key) => `unexpected ${key}`),
    ...findings
      .filter((finding) => finding.file !== fixture.file)
      .map((finding) => `${finding.id}@${String(finding.line)} names file "${finding.file}"`),
    ...findings
      .filter((finding) => finding.message.trim() === '')
      .map((finding) => `${finding.id}@${String(finding.line)} has no message`),
  ];
}

/** Registers one test per fixture of the rule. */
export function runRuleOnFixtures(ruleId: string, rule: Rule, root = FIXTURES_ROOT): void {
  const fixtures = loadFixtures(ruleId, root);
  describe(`${ruleId} fixtures`, () => {
    it.each(fixtures.map((fixture) => [`${fixture.kind}/${fixture.file}`, fixture] as const))(
      '%s',
      (_name, fixture) => {
        expect(fixtureProblems(ruleId, rule, fixture)).toEqual([]);
      },
    );
  });
}

const TYPICAL_LINES = [
  "import { readFileSync } from 'node:fs';",
  '',
  '// Prisma returns null for soft-deleted rows; treat them as missing (see #214).',
  'export async function getActiveUser(id: string): Promise<User | undefined> {',
  "  const url = 'https://example.com/api/users?id=' + encodeURIComponent(id); // not a comment",
  '  const user = await db.user.findFirst({ where: { id, deletedAt: null } });',
  '  /* TODO(#12): cache this lookup */',
  '  if (user === null) return undefined;',
  '  return { ...user, name: `${user.first} ${user.last}` };',
  '}',
];

export interface FastOptions {
  /** Line `index` of the generated file; defaults to cycling through typical TypeScript. */
  readonly generate?: (index: number) => string;
  readonly file?: string;
}

/** Runs the rule once on a generated 2,000-line file, all lines added, and asserts under 300 ms. */
export function assertFast(rule: Rule, options: FastOptions = {}): number {
  const {
    generate = (index) => TYPICAL_LINES[index % TYPICAL_LINES.length] ?? '',
    file = 'generated.ts',
  } = options;
  const lines = Array.from({ length: 2000 }, (_, index) => generate(index));
  const input: RuleInput = {
    file,
    content: `${lines.join('\n')}\n`,
    addedLines: lines.map((text, index) => ({ line: index + 1, text })),
  };
  const startedAt = performance.now();
  rule(input);
  const elapsed = performance.now() - startedAt;
  expect(elapsed, `rule took ${elapsed.toFixed(1)} ms on 2,000 lines`).toBeLessThan(300);
  return elapsed;
}
