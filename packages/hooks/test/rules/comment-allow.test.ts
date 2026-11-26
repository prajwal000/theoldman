import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { splitLines } from '../../src/lib/added-lines.js';
import { extractComments } from '../../src/lib/comments.js';
import type { Rule, RuleInput } from '../../src/lib/rules.js';
import { isAllowedComment, nextCodeLine } from '../../src/rules/comment-allow.js';
import { c02, c03 } from '../../src/rules/comment-code.js';
import { c06 } from '../../src/rules/comment-density.js';
import { c01, c04, c05 } from '../../src/rules/comments.js';
import { FIXTURES_ROOT } from '../harness.js';

const RULES: readonly (readonly [string, Rule])[] = [
  ['OLDMAN-C01', c01],
  ['OLDMAN-C02', c02],
  ['OLDMAN-C03', c03],
  ['OLDMAN-C04', c04],
  ['OLDMAN-C05', c05],
  ['OLDMAN-C06', c06],
];

function input(content: string, file = 'a.ts'): RuleInput {
  return {
    file,
    content,
    addedLines: splitLines(content).map((text, i) => ({ line: i + 1, text })),
  };
}

/** Whether the only comment in `source` is allow-listed. */
function allowed(source: string): boolean {
  const [comment] = extractComments(source, 'a.ts');
  if (comment === undefined) throw new Error('no comment in source');
  return isAllowedComment(comment, source.split('\n'));
}

describe('isAllowedComment', () => {
  it.each([
    ['a license header', '/* Copyright 2026 Example Ltd. All rights reserved. */'],
    ['an SPDX identifier', '// SPDX-License-Identifier: Apache-2.0'],
    ['a @license tag', '/*! @license MIT */'],
    ['TSDoc on an exported function', '/** Loads it. */\nexport function load() {}'],
    ['TSDoc on export default', '/** The app. */\n\nexport default App;'],
    [
      'TSDoc above decorators on an export',
      '/** A service. */\n@Injectable()\n@Other()\nexport class S {}',
    ],
    ['eslint-disable with a reason', '// eslint-disable-next-line no-console -- CLI output'],
    ['eslint-disable-line with a reason', 'f(); // eslint-disable-line -- legacy API'],
    ['a block eslint-disable with a reason', '/* eslint-disable max-lines -- generated file */'],
    ['@ts-expect-error with a reason', '// @ts-expect-error: the types are wrong upstream'],
    ['@ts-expect-error with a plain reason', '// @ts-expect-error types are wrong upstream'],
    ['a triple-slash directive', '/// <reference types="node" />'],
    ['a URL', '// Matches https://datatracker.ietf.org/doc/html/rfc3986'],
    ['an issue reference', '// Keep in step with the mobile client (#123)'],
  ])('allows %s', (_name, source) => {
    expect(allowed(source)).toBe(true);
  });

  it.each([
    ['TSDoc on a declaration that is not exported', '/** Loads it. */\nfunction load() {}'],
    ['TSDoc with nothing after it', '/** Orphaned. */'],
    ['a plain block comment above an export', '/* Loads it. */\nexport function load() {}'],
    ['eslint-disable without a reason', '// eslint-disable-next-line no-console'],
    ['@ts-expect-error without a reason', '// @ts-expect-error'],
    ['@ts-ignore', '// @ts-ignore because the types are wrong'],
    ['an ordinary comment', '// Retries back off exponentially.'],
  ])('does not allow %s', (_name, source) => {
    expect(allowed(source)).toBe(false);
  });

  it('never sees a shebang, which is not a comment', () => {
    expect(extractComments('#!/usr/bin/env node\nrun();', 'cli.ts')).toEqual([]);
  });
});

describe('nextCodeLine', () => {
  it('skips blank lines and comments, and decorators only when asked', () => {
    const lines = ['/** a */', '', '// b', '@Dec()', 'export class C {}'];
    expect(nextCodeLine(lines, 1)).toBe('@Dec()');
    expect(nextCodeLine(lines, 1, true)).toBe('export class C {}');
    expect(nextCodeLine(lines, 5)).toBeUndefined();
  });
});

describe('the allow-list across all comment rules', () => {
  const content = readFileSync(join(FIXTURES_ROOT, 'allow-list', 'everything-allowed.ts'), 'utf8');

  it.each(RULES)('%s flags nothing in a file of allow-listed comments', (_id, rule) => {
    expect(rule(input(content))).toEqual([]);
  });

  it.each([
    ['OLDMAN-C01', c01, '/* Updated yearly. */\nconst year = 2026;'],
    ['OLDMAN-C03', c03, '// const legacy = load();\nrun();'],
    ['OLDMAN-C03', c03, '// eslint-disable-next-line no-console, remove(after) launch;\nf();'],
    ['OLDMAN-C04', c04, '// TODO the library types are wrong'],
    ['OLDMAN-C01', c01, '/** Added in v2. */\nconst getUser = 1;'],
    ['OLDMAN-C05', c05, '/**\n * ==========\n */\nclass Service {}'],
  ])('%s flags the same comment once nothing allows it', (_id, rule, source) => {
    expect(rule(input(source)).length).toBeGreaterThan(0);
  });
});
