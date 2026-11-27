import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scoreDocs } from '../src/score/docs.ts';
import { scoreSecurity } from '../src/score/security.ts';
import { scoreTests } from '../src/score/tests.ts';
import type { TestCounts, ToolFinding } from '../src/score/workspace.ts';
import { CLAMP_DIFF } from './run-folders.ts';

const finding = (path: string, line: number, endLine = line, rule = 'some-rule'): ToolFinding => ({
  rule,
  path,
  line,
  endLine,
});

describe('scoreSecurity', () => {
  // CLAMP_DIFF adds lines 4 to 6 of src/math.ts; lines 1 to 3 are the starter's.
  it('counts Semgrep findings that cover a line the run added', () => {
    const semgrep = [
      finding('src/math.ts', 5, 5, 'eval-detected'),
      finding('src/math.ts', 2, 4, 'spans-into-added'),
    ];
    expect(scoreSecurity(CLAMP_DIFF, semgrep, [])).toEqual({
      semgrep: 2,
      gitleaks: 0,
      byRule: { 'eval-detected': 1, 'spans-into-added': 1 },
    });
  });

  it("does not count Semgrep findings in the starter's own lines or in unchanged files", () => {
    const semgrep = [finding('src/math.ts', 1, 3), finding('src/other.ts', 5)];
    expect(scoreSecurity(CLAMP_DIFF, semgrep, []).semgrep).toBe(0);
  });

  it('counts every gitleaks finding, since gitleaks only read the run', () => {
    const gitleaks = [finding('src/keys.ts', 1, 1, 'aws-access-token')];
    expect(scoreSecurity(CLAMP_DIFF, [], gitleaks)).toEqual({
      semgrep: 0,
      gitleaks: 1,
      byRule: { 'aws-access-token': 1 },
    });
  });

  it('has no count for a tool that could not scan', () => {
    expect(scoreSecurity(CLAMP_DIFF, null, null)).toEqual({
      semgrep: null,
      gitleaks: null,
      byRule: {},
    });
  });
});

describe('scoreTests', () => {
  const counts = (passed: number, failed: number, loaded = true): TestCounts => ({
    passed,
    failed,
    skipped: 0,
    loaded,
  });
  const HIDDEN = 'src/math.hidden.test.ts';

  it('gives the share of hidden tests passed and the tests added', () => {
    const score = scoreTests({
      hidden: [HIDDEN],
      starter: { [HIDDEN]: counts(0, 3), 'src/add.test.ts': counts(1, 0) },
      final: {
        [HIDDEN]: counts(2, 1),
        'src/add.test.ts': counts(1, 0),
        'src/math.test.ts': counts(3, 1),
      },
    });
    expect(score).toEqual({ hiddenPassRate: 2 / 3, testsAdded: 4, notes: [] });
  });

  it('counts a hidden file that no longer loads as all its starter tests failed', () => {
    const score = scoreTests({
      hidden: [HIDDEN],
      starter: { [HIDDEN]: counts(0, 3) },
      final: { [HIDDEN]: counts(0, 0, false) },
    });
    expect(score.hiddenPassRate).toBe(0);
  });

  it('counts tests the run removed as negative tests added', () => {
    const score = scoreTests({
      hidden: [],
      starter: { 'src/add.test.ts': counts(2, 0) },
      final: { 'src/add.test.ts': counts(1, 0) },
    });
    expect(score.testsAdded).toBe(-1);
  });

  it('ignores helper files in the hidden folder and notes a hidden file vitest skipped', () => {
    const score = scoreTests({
      hidden: [HIDDEN, 'src/fixtures.ts', 'src/other.hidden.test.ts'],
      starter: { [HIDDEN]: counts(0, 2), 'src/other.hidden.test.ts': counts(0, 1) },
      final: { [HIDDEN]: counts(2, 0) },
    });
    expect(score.hiddenPassRate).toBe(2 / 3);
    expect(score.notes).toEqual(['vitest did not run hidden test file src/other.hidden.test.ts']);
  });

  it('notes a hidden file that does not load on the starter', () => {
    const score = scoreTests({
      hidden: [HIDDEN],
      starter: { [HIDDEN]: counts(0, 0, false) },
      final: { [HIDDEN]: counts(1, 1) },
    });
    expect(score.hiddenPassRate).toBe(0.5);
    expect(score.notes[0]).toMatch(/did not load on the starter/);
  });

  it('has no values when vitest could not run', () => {
    expect(scoreTests({ hidden: [HIDDEN], starter: null, final: null })).toEqual({
      hiddenPassRate: null,
      testsAdded: null,
      notes: [],
    });
    const noStarter = scoreTests({
      hidden: [HIDDEN],
      starter: null,
      final: { [HIDDEN]: counts(1, 0) },
    });
    expect(noStarter.testsAdded).toBeNull();
    expect(noStarter.hiddenPassRate).toBe(1);
  });

  it('has no pass rate when no hidden test ran', () => {
    const score = scoreTests({ hidden: [HIDDEN], starter: {}, final: {} });
    expect(score.hiddenPassRate).toBeNull();
    expect(score.notes).toContain('no hidden tests ran: there is no hidden-test pass rate');
  });
});

describe('scoreDocs', () => {
  let starterDir: string;
  beforeEach(() => {
    starterDir = mkdtempSync(join(tmpdir(), 'theoldman-docs-'));
    mkdirSync(join(starterDir, 'src'));
    writeFileSync(
      join(starterDir, 'package.json'),
      JSON.stringify({ scripts: { test: 'vitest run' }, devDependencies: { vitest: '5.1.1' } }),
    );
  });
  afterEach(() => {
    rmSync(starterDir, { recursive: true, force: true });
  });

  const ENV_DIFF = `diff --git a/src/config.ts b/src/config.ts
new file mode 100644
--- /dev/null
+++ b/src/config.ts
@@ -0,0 +1 @@
+export const secret = process.env.JWT_SECRET;
`;

  const PACKAGE_DIFF = `diff --git a/package.json b/package.json
--- a/package.json
+++ b/package.json
@@ -1 +1 @@
-{"scripts":{"test":"vitest run"},"devDependencies":{"vitest":"5.1.1"}}
+{"scripts":{"test":"vitest run","seed":"tsx seed.ts"},"dependencies":{"left-pad":"1.3.0"},"devDependencies":{"vitest":"5.1.1"}}
`;
  const PACKAGE_NOW =
    '{"scripts":{"test":"vitest run","seed":"tsx seed.ts"},"dependencies":{"left-pad":"1.3.0"},"devDependencies":{"vitest":"5.1.1"}}';

  const score = (diff: string, extra: Partial<Parameters<typeof scoreDocs>[0]> = {}) =>
    scoreDocs({
      diff,
      files: {},
      envExamples: {},
      starterDirs: [starterDir],
      summary: '',
      ...extra,
    });

  it('flags an env variable no .env.example lists (OLDMAN-D01)', () => {
    expect(score(ENV_DIFF)).toEqual({ findings: 1, byRule: { 'OLDMAN-D01': 1 } });
  });

  it('accepts the variable once any .env.example in the project lists it', () => {
    const envExamples = { '.env.example': '# Signs session tokens\nJWT_SECRET=change-me\n' };
    expect(score(ENV_DIFF, { envExamples }).findings).toBe(0);
  });

  it("compares a changed package.json with the starter's (OLDMAN-D03, D04)", () => {
    const result = score(PACKAGE_DIFF, { files: { 'package.json': PACKAGE_NOW } });
    expect(result.byRule).toEqual({ 'OLDMAN-D03': 1, 'OLDMAN-D04': 1 });
  });

  it("takes the reason for a new dependency from Claude's summary", () => {
    const result = score(PACKAGE_DIFF, {
      files: { 'package.json': PACKAGE_NOW },
      summary: 'Added left-pad to pad the report columns.',
    });
    expect(result.byRule).toEqual({ 'OLDMAN-D04': 1 });
  });

  it('finds nothing for a change that needs no docs', () => {
    expect(score(CLAMP_DIFF)).toEqual({ findings: 0, byRule: {} });
  });
});
