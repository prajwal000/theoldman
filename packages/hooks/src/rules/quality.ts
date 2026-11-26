// Quality rules on the lines an edit added to a JS or TS file. They match code only: strings,
// template text, regex literals and comments are blanked first (lib/code-mask.ts), so
// `'console.log'` or `// as any` is never flagged. Each finding is a Fix.
//
// OLDMAN-Q01 `: any`, `as any`, `<any>` or `any` as a generic argument, in TypeScript files only.
// OLDMAN-Q02 `console.log` or `console.debug`, except in scripts/, bin/ and cli/ folders and tests.
// OLDMAN-Q03 an empty catch block, `catch {}` or `catch (e) {}`. A comment inside it counts as
// content, as in ESLint's no-empty: it says why the error is safe to ignore.
// OLDMAN-Q04 a `debugger` statement.

import { maskJs } from '../lib/code-mask.js';
import { supportsComments } from '../lib/comments.js';
import { normalizePath } from '../lib/paths.js';
import type { Finding, Rule } from '../lib/rules.js';

const TYPESCRIPT = /\.(?:ts|tsx|mts|cts)$/i;
const ANY: readonly RegExp[] = [/:\s*any\b/, /\bas\s+any\b/, /<\s*any\s*>/, /[<,]\s*any\s*[,>]/];
const CONSOLE = /\bconsole\s*\.\s*(?:log|debug)\s*\(/;
const DEBUGGER = /(?<![.\w$])debugger(?=\s*(?:;|$))/;
const EMPTY_CATCH = /\bcatch\s*(?:\([^)]*\))?\s*\{\s*\}/g;
const CLI_FOLDER = /(?:^|\/)(?:scripts|bin|cli)\//i;
const TEST_FILE = /(?:^|\/)(?:tests?|__tests__)\/|\.(?:test|spec)\.[cm]?[jt]sx?$/i;

function lineRule(
  id: Finding['id'],
  message: string,
  appliesTo: (file: string) => boolean,
  matches: (codeLine: string) => boolean,
): Rule {
  return (input) => {
    if (!supportsComments(input.file) || !appliesTo(input.file)) return [];
    const code = maskJs(input.content, input.file).split('\n');
    return input.addedLines
      .filter(({ line }) => matches(code[line - 1] ?? ''))
      .map(({ line }) => ({ id, action: 'fix', file: input.file, line, message }));
  };
}

export const q01 = lineRule(
  'OLDMAN-Q01',
  'Replace any with a real type, or with unknown and a type guard.',
  (file) => TYPESCRIPT.test(file),
  (code) => ANY.some((pattern) => pattern.test(code)),
);

export const q02 = lineRule(
  'OLDMAN-Q02',
  "Remove the console.log or console.debug, or use the project's logger.",
  (file) => !CLI_FOLDER.test(normalizePath(file)) && !TEST_FILE.test(normalizePath(file)),
  (code) => CONSOLE.test(code),
);

export const q04 = lineRule(
  'OLDMAN-Q04',
  'Remove the debugger statement.',
  () => true,
  (code) => DEBUGGER.test(code),
);

export const q03: Rule = (input) => {
  if (!supportsComments(input.file)) return [];
  // Match in code with comments blanked, so `catch {}` inside a comment is not found; then look
  // at the same span with comments kept, where a comment-only block is no longer empty.
  const code = maskJs(input.content, input.file);
  const withComments = maskJs(input.content, input.file, { keepComments: true });
  const added = new Set(input.addedLines.map(({ line }) => line));
  return [...code.matchAll(EMPTY_CATCH)].flatMap((match): Finding[] => {
    const block = withComments.slice(match.index, match.index + match[0].length);
    if (!/\{\s*\}$/.test(block)) return [];
    const line = code.slice(0, match.index).split('\n').length;
    const lastLine = line + match[0].split('\n').length - 1;
    const touched = Array.from({ length: lastLine - line + 1 }, (_, i) => line + i).some((l) =>
      added.has(l),
    );
    if (!touched) return [];
    return [
      {
        id: 'OLDMAN-Q03',
        action: 'fix',
        file: input.file,
        line,
        message:
          'Handle or rethrow the error in this catch block, or add a comment saying why it is safe to ignore.',
      },
    ];
  });
};
