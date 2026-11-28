import { execFileSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigError } from '../src/errors.ts';
import { commitMessage, goldenPrHash, loadGoldenPr, loadReviewPrompt } from '../src/golden-pr.ts';

const PRS = fileURLToPath(new URL('../golden-prs/', import.meta.url));
const STARTERS = fileURLToPath(new URL('../starters/', import.meta.url));
const ids = readdirSync(PRS, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

describe('the golden PR list', () => {
  it('names every golden PR in golden-prs/README.md, and nothing else', () => {
    const listed = [...readFileSync(join(PRS, 'README.md'), 'utf8').matchAll(/^\| `([^`]+)`/gm)]
      .map((match) => match[1])
      .sort();
    expect(listed).toEqual([...ids].sort());
  });

  it('has a bug PR, a clean PR and an injection PR', () => {
    const prs = ids.map((id) => loadGoldenPr(PRS, id));
    expect(prs.some((pr) => !pr.clean && pr.injection === null)).toBe(true);
    expect(prs.some((pr) => pr.clean)).toBe(true);
    expect(prs.some((pr) => pr.injection !== null)).toBe(true);
  });

  it('has a review prompt that does not hint at any PR', () => {
    const prompt = loadReviewPrompt(PRS);
    expect(prompt).toMatch(/against `main`/);
    for (const id of ids) {
      for (const comment of loadGoldenPr(PRS, id).comments) {
        expect(prompt).not.toContain(comment.id);
      }
    }
  });
});

describe.each(ids)('golden PR %s', (id) => {
  const pr = loadGoldenPr(PRS, id);

  // The golden lines must point into the file as the PR leaves it, so the patch is applied to
  // a copy of the starter and each golden line read back.
  it('applies to its starter, and each golden comment points at a line the PR adds', () => {
    const work = mkdtempSync(join(tmpdir(), `theoldman-pr-${id}-`));
    try {
      for (const dir of pr.starterDirs) cpSync(dir, work, { recursive: true });
      const patch = join(work, '..', `${id}-${String(process.pid)}.patch`);
      writeFileSync(patch, pr.patch);
      try {
        execFileSync('git', ['apply', '--whitespace=nowarn', patch], { cwd: work, stdio: 'pipe' });
      } finally {
        rmSync(patch, { force: true });
      }
      for (const comment of pr.comments) {
        // git may write CRLF line endings on Windows.
        const lines = readFileSync(join(work, comment.file), 'utf8').split(/\r?\n/);
        const line = lines[comment.line - 1] ?? '';
        expect(line.trim(), `${comment.id} at ${comment.file}:${String(comment.line)}`).not.toBe(
          '',
        );
        expect(pr.patch).toContain(`+${line}\n`);
      }
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });

  it('keeps the bug out of what Claude sees: branch, title and description', () => {
    const seen = `${pr.branch}\n${commitMessage(pr)}`.toLowerCase();
    for (const comment of pr.comments) expect(seen).not.toContain(comment.id);
    expect(seen).not.toMatch(/\b(?:bug|inject|golden|vulnerab)/);
  });
});

describe('loadGoldenPr', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'theoldman-golden-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const PATCH = `diff --git a/src/a.ts b/src/a.ts
new file mode 100644
--- /dev/null
+++ b/src/a.ts
@@ -0,0 +1,2 @@
+export const a = 1;
+export const b = 2;
`;
  const VALID = {
    title: 'Add a',
    description: 'Adds a.',
    base: 'next-prisma',
    branch: 'add-a',
    comments: [{ id: 'one', file: 'src/a.ts', line: 1, issue: 'Wrong value.' }],
  };

  function write(json: Record<string, unknown>, patch = PATCH): string {
    const dir = join(root, 'pr');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'pr.json'), JSON.stringify(json));
    writeFileSync(join(dir, 'pr.patch'), patch);
    return 'pr';
  }
  const load = (json: Record<string, unknown>, patch?: string) =>
    loadGoldenPr(root, write(json, patch), STARTERS);

  it('loads a valid PR on the shared starter', () => {
    const pr = load(VALID);
    expect(pr.starterDirs).toEqual([join(STARTERS, 'next-prisma')]);
    expect(pr.clean).toBe(false);
    expect(pr.injection).toBeNull();
    expect(commitMessage(pr)).toBe('Add a\n\nAdds a.\n');
  });

  it.each([
    [{ ...VALID, extra: 1 }, /unknown field extra/],
    [{ ...VALID, base: '../x' }, /"base"/],
    [{ ...VALID, base: 'missing' }, /does not exist/],
    [{ ...VALID, branch: 'main' }, /"branch"/],
    [{ ...VALID, branch: '-x' }, /"branch"/],
    [{ ...VALID, comments: [] }, /mark the PR "clean"/],
    [{ ...VALID, clean: true }, /clean PR cannot have golden comments/],
    [{ ...VALID, comments: [{ ...VALID.comments[0], file: 'src/b.ts' }] }, /file the patch/],
    [{ ...VALID, comments: [{ ...VALID.comments[0], line: 0 }] }, /line number/],
    [{ ...VALID, comments: [VALID.comments[0], VALID.comments[0]] }, /used twice/],
    [{ ...VALID, comments: [{ ...VALID.comments[0], severity: 'x' }] }, /unknown field/],
    [{ ...VALID, injection: { instruction: 'x', followedIf: [] } }, /followedIf" is empty/],
    [
      {
        ...VALID,
        injection: { instruction: 'x', followedIf: [{ tools: ['Bash'], pattern: '(' }] },
      },
      /not a valid regular expression/,
    ],
    [{ ...VALID, injection: { instruction: 'x', followedIf: [{ pattern: 'a' }] } }, /"tools"/],
  ])('refuses %j', (json, message) => {
    expect(() => load(json)).toThrow(ConfigError);
    expect(() => load(json)).toThrow(message);
  });

  it('refuses a patch that is not a git diff', () => {
    expect(() => load(VALID, 'not a diff')).toThrow(/not a git diff/);
  });

  it('refuses an ID that could leave the folder', () => {
    expect(() => loadGoldenPr(root, '../pr', STARTERS)).toThrow(/not found/);
  });

  it('changes its hash when the patch or the message changes', () => {
    const before = goldenPrHash(load(VALID));
    expect(goldenPrHash(load({ ...VALID, title: 'Add b' }))).not.toBe(before);
    expect(goldenPrHash(load(VALID, `${PATCH}+export const c = 3;\n`))).not.toBe(before);
    expect(goldenPrHash(load({ ...VALID, comments: [{ ...VALID.comments[0], line: 2 }] }))).toBe(
      before,
    );
  });
});
