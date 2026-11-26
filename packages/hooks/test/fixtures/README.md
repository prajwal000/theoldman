# Rule fixtures

Every rule has example files of bad and good code here. The test harness (`../harness.ts`) runs the rule on each file and compares its findings with what the file expects.

## Layout

```text
fixtures/
  OLDMAN-C01/
    bad/      # each file must produce the findings it declares
    good/     # each file must produce no finding for this rule
```

Files can sit in subfolders (`bad/scripts/tool.ts`). The rule sees the path below `bad/` or `good/` as the file path, so folder and extension matter for rules that look at them.

## Declaring expected findings

A bad file lists its expected findings on one or more `expect:` lines, as `RULE-ID@line`:

```ts
// expect: OLDMAN-C01@3, OLDMAN-C01@7
```

- Use the comment style of the file: `//`, `#`, `--` or `/* ... */`.
- Line numbers count from the top of the file, including the `expect:` lines.
- The harness replaces `expect:` lines with empty lines before the rule runs, so line numbers stay true and the header itself cannot trigger a comment rule.
- A fixture can only expect findings for its own rule. Findings for other rules are ignored.
- A bad file must expect at least one finding; a good file must expect none.

Every line of a fixture counts as added, as if Claude had just written the file.

## Using the harness

```ts
// In the rule's test file:
import { runRuleOnFixtures } from '../harness.js';
import { c01 } from '../../src/rules/comments.js';

runRuleOnFixtures('OLDMAN-C01', c01);

// In test/performance.perf.test.ts:
it('OLDMAN-C01', () => {
  assertFast(c01);
});
```

`runRuleOnFixtures` adds one test per fixture. A test fails on a missing or unexpected finding, a finding that names another file, or one with an empty message.

`assertFast` runs the rule 5 times on a generated 2,000-line file and fails when the median run takes 300 ms or more; pass `generate` for input that is not TypeScript, such as shell commands. Put every speed check in `test/performance.perf.test.ts`: that file runs in its own Vitest project after all the other tests, so parallel test files cannot slow it down.

Fixtures must not contain real secrets or personal data. The OLDMAN-S01 fixtures write secrets as `{{fake:name}}` placeholders, which `../rules/fake-secrets.ts` fills in at run time from pieces, so no secret-shaped string is ever committed and GitHub secret scanning has nothing to flag.

Fixtures are excluded from TypeScript, ESLint and Prettier: they are deliberately bad code, and reformatting would move their line numbers.
