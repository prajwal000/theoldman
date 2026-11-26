// Turns one command line into the units the guards check: the line itself, the strings it hands
// to other shells (nested.ts), and the package.json scripts it runs (wrappers.ts). Each command
// knows the directory it runs in, following `cd`, `Set-Location` and `pushd`/`popd` on the line,
// and each unit knows the variables set before it (`VAR=x`, `export`, `$env:`).

import type { PackageScripts } from '../lib/package-scripts.js';
import { resolvePath } from '../lib/paths.js';
import { type Dialect, isAbbreviation, parseCommands, programName } from '../lib/shell.js';
import type { GuardContext } from './guard-context.js';
import { nestedCommand } from './nested.js';
import { unwrap } from './wrappers.js';

export interface LocatedCommand {
  readonly words: readonly string[];
  /** Undefined after a `cd` the guard cannot follow, such as `cd "$DIR"` or `cd -`. */
  readonly cwd: string | undefined;
  readonly redirects: readonly string[];
}

export interface CommandUnit {
  readonly text: string;
  readonly dialect: Dialect;
  readonly commands: readonly LocatedCommand[];
  /** Upper-case names, so PowerShell's case-insensitive `$env:` names match too. */
  readonly variables: ReadonlyMap<string, string>;
}

const MAX_NESTING = 4;
// The first script is followed, then at most this many script-to-script calls below it.
const MAX_SCRIPT_CALLS = 2;
const HOME = /^(?:~|\$HOME|\$\{HOME\}|\$env:HOME|\$env:USERPROFILE|%USERPROFILE%)(?=$|[/\\])/i;
const CHANGE_DIR = new Set(['cd', 'chdir', 'set-location', 'sl', 'pushd', 'push-location']);
const POP_DIR = new Set(['popd', 'pop-location']);

/** Absolute form of a path argument, or undefined when it depends on something we cannot see. */
export function resolveTarget(
  target: string,
  cwd: string | undefined,
  home: string,
): string | undefined {
  const expanded = target.replace(HOME, home);
  if (/\$\{?\w|%\w+%/.test(expanded)) return undefined;
  const absolute = /^(?:[A-Za-z]:|[/\\])/.test(expanded);
  if (cwd === undefined && !absolute) return undefined;
  return resolvePath(expanded, cwd ?? '/');
}

function setVariable(variables: Map<string, string>, piece: string): void {
  const equals = piece.indexOf('=');
  if (equals <= 0) return;
  variables.set(
    piece
      .slice(0, equals)
      .replace(/^\$env:/i, '')
      .toUpperCase(),
    piece.slice(equals + 1),
  );
}

/** The directory argument of cd / Set-Location, or null when there is none. */
function directoryArgument(words: readonly string[], dialect: Dialect): string | null {
  const args = words.slice(1);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? '';
    const name = arg.slice(1).toLowerCase();
    if (dialect === 'powershell' && arg.startsWith('-')) {
      if (isAbbreviation(name, 'path', 3) || isAbbreviation(name, 'literalpath', 1)) {
        return args[i + 1] ?? null;
      }
    } else if (dialect === 'powershell' && name === 'd' && arg.startsWith('/')) {
      continue;
    } else if (!(dialect === 'bash' && arg.startsWith('-') && arg !== '-')) {
      return arg;
    }
  }
  return null;
}

export function expandCommands(
  text: string,
  dialect: Dialect,
  context: GuardContext,
): CommandUnit[] {
  const units: CommandUnit[] = [];
  const scriptsByDir = new Map<string, PackageScripts | undefined>();
  const scriptsAt = (dir: string | undefined): PackageScripts | undefined => {
    if (dir === undefined) return undefined;
    if (!scriptsByDir.has(dir)) scriptsByDir.set(dir, context.packageScripts(dir));
    return scriptsByDir.get(dir);
  };

  const visit = (
    line: string,
    lineDialect: Dialect,
    startCwd: string | undefined,
    inherited: ReadonlyMap<string, string>,
    depth: number,
    scriptDepth: number,
  ): void => {
    const variables = new Map(inherited);
    const commands: LocatedCommand[] = [];
    units.push({ text: line, dialect: lineDialect, commands, variables });
    let cwd = startCwd;
    const stack: (string | undefined)[] = [];
    for (const { assignments, words: raw, redirects } of parseCommands(line, lineDialect)) {
      const exported = raw[0] === 'export' ? raw.slice(1) : [];
      for (const piece of [...assignments, ...exported]) setVariable(variables, piece);
      // PowerShell splits `$env:NAME = "value"` into words; joined they read `$env:NAME=value`.
      if (/^\$env:/i.test(raw[0] ?? '')) setVariable(variables, raw.join(''));
      const unwrapped = unwrap(raw, (name) => scriptsAt(cwd)?.scripts.has(name) ?? false);
      if (unwrapped.kind === 'script') {
        const pkg = scriptsAt(cwd);
        if (pkg !== undefined && depth < MAX_NESTING && scriptDepth <= MAX_SCRIPT_CALLS) {
          for (const name of [`pre${unwrapped.name}`, unwrapped.name, `post${unwrapped.name}`]) {
            const script = pkg.scripts.get(name);
            if (script !== undefined)
              visit(script, 'bash', pkg.dir, variables, depth + 1, scriptDepth + 1);
          }
        }
        continue;
      }
      const { words } = unwrapped;
      const program = programName(words[0] ?? '');
      if (CHANGE_DIR.has(program)) {
        if (program === 'pushd' || program === 'push-location') stack.push(cwd);
        const target = directoryArgument(words, lineDialect);
        if (target === null) {
          // A bare `cd` goes home in bash; a bare Set-Location stays put.
          if (lineDialect === 'bash') cwd = context.home;
        } else {
          cwd = target === '-' ? undefined : resolveTarget(target, cwd, context.home);
        }
        continue;
      }
      if (POP_DIR.has(program)) {
        if (stack.length > 0) cwd = stack.pop();
        continue;
      }
      const nested = nestedCommand(words);
      if (nested !== undefined && depth < MAX_NESTING) {
        visit(nested.text, nested.dialect, cwd, variables, depth + 1, scriptDepth);
      }
      commands.push({ words, cwd, redirects });
    }
  };

  visit(text, dialect, context.cwd, new Map(), 0, 0);
  return units;
}
