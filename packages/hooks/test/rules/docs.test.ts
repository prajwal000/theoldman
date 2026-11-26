import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { workingTreeDiff } from '../../src/lib/diff.js';
import type { DocsContext } from '../../src/rules/docs-context.js';
import { buildDocsContext } from '../../src/rules/docs-context.js';
import { checkDocs, d01, d02, d03, d04, type DocsRule } from '../../src/rules/docs.js';
import { FIXTURES_ROOT } from '../harness.js';

const scratch = mkdtempSync(join(tmpdir(), 'theoldman-docs-'));
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): void {
  execFileSync(
    'git',
    ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args],
    { cwd, stdio: 'ignore' },
  );
}

/** A repo with `before/` committed and `after/` laid over it as uncommitted changes. */
function repoFromCase(caseDir: string): string {
  const repo = mkdtempSync(join(scratch, 'repo-'));
  git(repo, 'init', '-q');
  if (existsSync(join(caseDir, 'before')))
    cpSync(join(caseDir, 'before'), repo, { recursive: true });
  writeFileSync(join(repo, '.fixture-base'), '');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'before');
  if (existsSync(join(caseDir, 'after'))) cpSync(join(caseDir, 'after'), repo, { recursive: true });
  return repo;
}

const readLines = (file: string): string[] =>
  existsSync(file)
    ? readFileSync(file, 'utf8')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line !== '')
    : [];

// Building a repo takes several git calls; each case is built once and shared between tests.
const contexts = new Map<string, DocsContext>();

function contextFor(caseDir: string): DocsContext {
  const cached = contexts.get(caseDir);
  if (cached !== undefined) return cached;
  const repo = repoFromCase(caseDir);
  const summary = existsSync(join(caseDir, 'summary.txt'))
    ? readFileSync(join(caseDir, 'summary.txt'), 'utf8')
    : '';
  const context = buildDocsContext(repo, workingTreeDiff(repo), summary);
  contexts.set(caseDir, context);
  return context;
}

// Each case is a repo: before/ is committed, after/ is the session's uncommitted work, and
// expect.txt lists `ID path:line` per finding (none for good cases).
function runDocsFixtures(ruleId: string, rule: DocsRule): void {
  describe(`${ruleId} fixtures`, () => {
    for (const kind of ['bad', 'good'] as const) {
      const kindDir = join(FIXTURES_ROOT, ruleId, kind);
      const names = readdirSync(kindDir);
      it(`has ${kind} cases`, () => {
        expect(names.length).toBeGreaterThan(0);
      });
      it.each(names)(`${kind}/%s`, (name) => {
        const caseDir = join(kindDir, name);
        const found = rule(contextFor(caseDir)).map((f) => `${f.id} ${f.file}:${String(f.line)}`);
        const expected = readLines(join(caseDir, 'expect.txt'));
        expect(found.sort()).toEqual(expected.sort());
        if (kind === 'bad') expect(expected.length).toBeGreaterThan(0);
      });
    }
  });
}

runDocsFixtures('OLDMAN-D01', d01);
runDocsFixtures('OLDMAN-D02', d02);
runDocsFixtures('OLDMAN-D03', d03);
runDocsFixtures('OLDMAN-D04', d04);

describe('docs findings', () => {
  const badCase = (rule: string, name: string): DocsContext =>
    contextFor(join(FIXTURES_ROOT, rule, 'bad', name));

  it('make D01 a Fix and D02 to D04 warnings, with messages that say what to do', () => {
    const d01Finding = d01(badCase('OLDMAN-D01', 'new-env-vars')).find(
      (finding) => finding.file === 'src/client.ts',
    );
    expect(d01Finding).toMatchObject({ action: 'fix', file: 'src/client.ts', line: 1 });
    expect(d01Finding?.message).toBe(
      'process.env.API_TOKEN is read here but no .env.example lists API_TOKEN. Add API_TOKEN= with a placeholder value and a short comment.',
    );
    expect(d02(badCase('OLDMAN-D02', 'route-changed'))[0]).toMatchObject({
      action: 'warn',
      message:
        'API route files changed (app/api/orders/route.ts, src/routes/users.ts) but no OpenAPI or route docs did. Check whether the API docs need an update.',
    });
    expect(d03(badCase('OLDMAN-D03', 'new-dependencies'))[0]).toMatchObject({
      action: 'warn',
      message:
        'New dependency lodash has no ADR and no reason in your summary. Say in one line why it is needed, or add an ADR.',
    });
    expect(d04(badCase('OLDMAN-D04', 'scripts-and-docker'))[0]).toMatchObject({
      action: 'warn',
      message:
        'package.json scripts, Dockerfile changed but no README did. Check that the setup steps and commands in the README are still right.',
    });
  });

  it('checkDocs runs every rule', () => {
    const ids = checkDocs(badCase('OLDMAN-D03', 'new-dependencies')).map((f) => f.id);
    expect(ids).toEqual(['OLDMAN-D03', 'OLDMAN-D03', 'OLDMAN-D03']);
  });

  it('lists at most three files in a message and counts the rest', () => {
    const files = ['a', 'b', 'c', 'd', 'e'].map((name) => ({
      path: `src/routes/${name}.ts`,
      status: 'modified' as const,
      addedLines: [],
    }));
    const context = {
      files,
      exampleVars: new Set<string>(),
      newDependencies: [],
      scriptChanges: [],
      summary: '',
    };
    expect(d02(context)[0]).toMatchObject({ line: 1 });
    expect(d02(context)[0]?.message).toContain('src/routes/c.ts and 2 more)');
  });

  it('reads no .env.example and no package.json outside a git repository', () => {
    const loose = mkdtempSync(join(scratch, 'loose-'));
    writeFileSync(join(loose, 'package.json'), '{not json');
    const diff =
      'diff --git a/package.json b/package.json\n--- a/package.json\n+++ b/package.json\n@@ -1 +1 @@\n+{not json\n';
    const context = buildDocsContext(loose, diff);
    expect([...context.exampleVars]).toEqual([]);
    expect(context.newDependencies).toEqual([]);
    expect(
      buildDocsContext(loose, diff.replaceAll('package.json', 'gone/package.json')).scriptChanges,
    ).toEqual([]);
  });
});
