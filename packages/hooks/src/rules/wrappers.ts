// Package-manager prefixes: `npx`, `bunx`, `npm exec`, `pnpm exec|dlx`, `yarn exec|dlx` run a
// program, so they are stripped before matching; `npm|pnpm|yarn|bun run <name>` (and `npm test`,
// `yarn <name>`, ...) run a package.json script, which the caller looks up and checks instead.
// `sudo`, `env` and `VAR=x` prefixes are already removed by lib/shell.ts.

import { programName } from '../lib/shell.js';

export type Unwrapped =
  | { readonly kind: 'command'; readonly words: readonly string[] }
  | { readonly kind: 'script'; readonly name: string };

const RUNNERS = new Set(['npx', 'bunx', 'pnpx']);
const EXEC_SUBCOMMANDS: Record<string, readonly string[]> = {
  npm: ['exec', 'x'],
  pnpm: ['exec', 'dlx'],
  yarn: ['exec', 'dlx'],
  bun: ['x'],
};
const RUN_SUBCOMMANDS = new Set(['run', 'run-script', 'rum', 'urn']);
const LIFECYCLE: Record<string, string> = {
  test: 'test',
  t: 'test',
  tst: 'test',
  start: 'start',
  stop: 'stop',
  restart: 'restart',
};

/** Words after the runner's own flags (`npx -y --package=x prisma` -> `prisma ...`). */
function afterFlags(words: readonly string[], from: number): readonly string[] {
  let i = from;
  while (i < words.length && (words[i] ?? '').startsWith('-')) {
    i += words[i] === '-p' || words[i] === '--package' ? 2 : 1;
  }
  return words.slice(i);
}

function unwrapOnce(
  words: readonly string[],
  isScript: (name: string) => boolean,
): Unwrapped | undefined {
  const program = programName(words[0] ?? '');
  const sub = words[1] ?? '';
  if (RUNNERS.has(program)) return { kind: 'command', words: afterFlags(words, 1) };
  if (!['npm', 'pnpm', 'yarn', 'bun'].includes(program)) return undefined;
  if (EXEC_SUBCOMMANDS[program]?.includes(sub) === true) {
    return { kind: 'command', words: afterFlags(words, 2) };
  }
  if (RUN_SUBCOMMANDS.has(sub)) {
    const [name] = afterFlags(words, 2);
    return name === undefined ? undefined : { kind: 'script', name };
  }
  const lifecycle = program === 'bun' ? undefined : LIFECYCLE[sub];
  if (lifecycle !== undefined) return { kind: 'script', name: lifecycle };
  // pnpm and yarn run a script given by name alone, and otherwise a program of that name.
  if (program === 'pnpm' || program === 'yarn') {
    return isScript(sub)
      ? { kind: 'script', name: sub }
      : { kind: 'command', words: words.slice(1) };
  }
  return undefined;
}

/** Strips package-manager prefixes (several, if stacked) or reports the script a command runs. */
export function unwrap(words: readonly string[], isScript: (name: string) => boolean): Unwrapped {
  let current: Unwrapped = { kind: 'command', words };
  for (let round = 0; round < 3 && current.kind === 'command'; round++) {
    const next = unwrapOnce(current.words, isScript);
    if (next === undefined) break;
    current = next;
  }
  return current;
}
