// Enforces ADR 0002 on bundled hook scripts. It reads source text, not an AST: esbuild output
// is regular enough for that, and any construct it cannot vouch for is reported, not allowed.

const FORBIDDEN_MODULES = [
  'http',
  'https',
  'http2',
  'net',
  'tls',
  'dgram',
  'dns',
  'worker_threads',
];
const FORBIDDEN_CALLS: readonly (readonly [RegExp, string])[] = [
  [/\bfetch\s*\(/, 'calls fetch('],
  [/\beval\s*\(/, 'calls eval('],
  [/\bnew\s+Function\s*\(/, 'calls new Function('],
];
const NETWORK_SUBCOMMAND = /(["'`])(?:fetch|pull|push|clone|ls-remote|remote)\1/;

function moduleReference(name: string): RegExp {
  return new RegExp(
    String.raw`(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)(["'\`])(?:node:)?${name}\1`,
  );
}

function count(code: string, pattern: RegExp): number {
  return [...code.matchAll(new RegExp(pattern.source, 'g'))].length;
}

/** Text of the array literal that starts at `open` (an index of `[`), brackets included. */
function arrayAt(code: string, open: number): string {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === '[') depth++;
    if (code[i] === ']' && --depth === 0) return code.slice(open, i + 1);
  }
  return code.slice(open);
}

function childProcessProblems(code: string): string[] {
  const problems: string[] = [];
  const references = count(code, /(["'`])(?:node:)?child_process\1/);
  const allowedImports = count(
    code,
    /import\s*\{\s*execFileSync\s*\}\s*from\s*(["'])(?:node:)?child_process\1/,
  );
  if (references !== allowedImports) {
    problems.push('uses child_process other than `import { execFileSync }`');
  }
  const allowedCalls = count(code, /\bexecFileSync\s*\(\s*(["'])git\1\s*,\s*\[/);
  if (count(code, /\bexecFileSync\b/) !== allowedImports + allowedCalls) {
    problems.push("uses execFileSync other than as execFileSync('git', [...])");
  }
  if (/\bshell\s*:|(["'])shell\1\s*:/.test(code)) {
    problems.push('sets a shell option');
  }
  // Git argument arrays: the one passed to execFileSync('git', ...) and those passed to runGit.
  const argumentArrays =
    /\bexecFileSync\s*\(\s*(["'])git\1\s*,\s*\[|\brunGit\d*\s*\([^,()]*,\s*\[/g;
  for (const match of code.matchAll(argumentArrays)) {
    if (NETWORK_SUBCOMMAND.test(arrayAt(code, match.index + match[0].length - 1))) {
      problems.push('passes a git network subcommand');
    }
  }
  return problems;
}

/** Every way `code` breaks ADR 0002; empty when it is safe. */
export function findSafetyViolations(code: string): string[] {
  return [
    ...FORBIDDEN_MODULES.filter((name) => moduleReference(name).test(code)).map(
      (name) => `imports ${name}`,
    ),
    ...FORBIDDEN_CALLS.filter(([pattern]) => pattern.test(code)).map(([, problem]) => problem),
    ...childProcessProblems(code),
  ];
}
