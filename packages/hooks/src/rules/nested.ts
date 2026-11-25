// Commands passed to another shell as a string: `bash -c "..."`, `cmd /c ...`, `pwsh -Command
// ...` and `-EncodedCommand <base64>`. The guards check the string as a command of its own.
// A script file (`bash deploy.sh`, `pwsh -File x.ps1`) is not read.

import { Buffer } from 'node:buffer';
import { type Dialect, isAbbreviation, programName } from '../lib/shell.js';

export interface NestedCommand {
  readonly text: string;
  readonly dialect: Dialect;
}

const POSIX_SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh']);
const PWSH_VALUE_PARAMETERS: readonly (readonly [string, number])[] = [
  ['executionpolicy', 2],
  ['ep', 2],
  ['windowstyle', 2],
  ['workingdirectory', 2],
  ['wd', 2],
  ['configurationname', 3],
  ['outputformat', 1],
  ['inputformat', 2],
  ['version', 1],
  ['settingsfile', 1],
  ['custompipename', 2],
  ['psconsolefile', 2],
];

/** `-c` in any short-option group (`-c`, `-lc`, `-ec`) makes the first operand a command. */
function posixShellCommand(args: readonly string[]): string | undefined {
  let command = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? '';
    if (['-o', '+o', '--rcfile', '--init-file'].includes(arg)) {
      i++;
    } else if (arg.startsWith('-') || arg.startsWith('+')) {
      command ||= /^-[^-]*c/.test(arg);
    } else {
      return command ? arg : undefined;
    }
  }
  return undefined;
}

function decodeBase64Utf16(value: string | undefined): string | undefined {
  if (value === undefined || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return undefined;
  return Buffer.from(value, 'base64').toString('utf16le');
}

/** Windows PowerShell treats a bare first argument as the command; pwsh treats it as a file. */
function powershellCommand(
  args: readonly string[],
  windowsPowerShell: boolean,
): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? '';
    if (!arg.startsWith('-')) return windowsPowerShell ? args.slice(i).join(' ') : undefined;
    const name = arg.slice(1).toLowerCase();
    if (isAbbreviation(name, 'command', 1)) return args.slice(i + 1).join(' ');
    if (name === 'e' || name === 'ec' || isAbbreviation(name, 'encodedcommand', 2)) {
      return decodeBase64Utf16(args[i + 1]);
    }
    if (isAbbreviation(name, 'file', 1)) return undefined;
    if (PWSH_VALUE_PARAMETERS.some(([p, shortest]) => isAbbreviation(name, p, shortest))) i++;
  }
  return undefined;
}

/** The command string this one hands to another shell, if any. */
export function nestedCommand(words: readonly string[]): NestedCommand | undefined {
  const program = programName(words[0] ?? '');
  const args = words.slice(1);
  let text: string | undefined;
  let dialect: Dialect = 'bash';
  if (POSIX_SHELLS.has(program)) {
    text = posixShellCommand(args);
  } else if (program === 'cmd') {
    // cmd keeps backslashes and splits on & | like PowerShell, so its splitter fits best.
    const at = args.findIndex((arg) => /^\/[ck]$/i.test(arg));
    text = at === -1 ? undefined : args.slice(at + 1).join(' ');
    dialect = 'powershell';
  } else if (program === 'pwsh' || program === 'powershell') {
    text = powershellCommand(args, program === 'powershell');
    dialect = 'powershell';
  }
  return text === undefined || text.trim() === '' ? undefined : { text, dialect };
}
