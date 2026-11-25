// A best-effort splitter for the commands Claude runs through the Bash and PowerShell tools. It
// finds the simple commands in a line so guards can look at their program and arguments. It is
// not a shell parser; the gaps that matter to guards are listed in rules/guard-bash.ts.

export type Dialect = 'bash' | 'powershell';

interface Word {
  text: string;
  quoted: boolean;
}

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const WRAPPERS = new Set(['env', 'command', 'exec', 'time', 'nohup', 'sudo']);
const SEPARATORS = new Set([';', '|', '&', '(', ')']);
// `>`, `2>>`, `&>`, `<`, `2>&1`, `>file`: group 1 is a `&N` target, group 2 an attached file.
const REDIRECT = /^(?:\d*|&)(?:>>?|<<?)(&\d*|&-)?(.*)$/;

/** True when `name` (lower-case, no dash) is an abbreviation PowerShell accepts for `parameter`. */
export function isAbbreviation(name: string, parameter: string, shortest: number): boolean {
  return name.length >= shortest && parameter.startsWith(name);
}

/** Lower-case program name without directory or `.exe`: `C:\Git\bin\git.exe` -> `git`. */
export function programName(word: string): string {
  return (word.split(/[/\\]/).pop() ?? '').toLowerCase().replace(/\.(?:exe|cmd|bat)$/, '');
}

/** Reads a quoted string starting at `start` (the opening quote); returns its text and end index. */
function readQuoted(text: string, start: number, dialect: Dialect): [string, number] {
  const quote = text.charAt(start);
  let value = '';
  for (let i = start + 1; i < text.length; i++) {
    const char = text.charAt(i);
    const next = text.charAt(i + 1);
    if (char === quote && quote === "'" && dialect === 'powershell' && next === "'") {
      value += "'";
      i++;
    } else if (char === quote && quote === '"' && dialect === 'powershell' && next === '"') {
      value += '"';
      i++;
    } else if (char === quote) {
      return [value, i];
    } else if (quote === '"' && dialect === 'bash' && char === '\\' && '"\\$`\n'.includes(next)) {
      value += next === '\n' ? '' : next;
      i++;
    } else if (quote === '"' && dialect === 'powershell' && char === '`') {
      value += next;
      i++;
    } else {
      value += char;
    }
  }
  return [value, text.length];
}

export interface SimpleCommand {
  /** Leading `NAME=value` words, as in `DATABASE_URL=... npx prisma migrate reset`. */
  readonly assignments: readonly string[];
  readonly words: readonly string[];
}

function finish(words: readonly Word[]): SimpleCommand {
  const assignments: string[] = [];
  const kept: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i] ?? { text: '', quoted: false };
    const redirect = word.quoted ? null : REDIRECT.exec(word.text);
    if (redirect === null) {
      kept.push(word.text);
    } else if (redirect[1] === undefined && redirect[2] === '') {
      i++;
    }
  }
  let start = 0;
  while (start < kept.length) {
    const word = kept[start] ?? '';
    if (ASSIGNMENT.test(word)) {
      assignments.push(word);
      start++;
    } else if (WRAPPERS.has(programName(word))) {
      start++;
      while (kept[start]?.startsWith('-') === true) start++;
    } else {
      break;
    }
  }
  return { assignments, words: kept.slice(start) };
}

/** Like {@link parseCommands}, but only the words of commands that run a program. */
export function splitCommands(input: string, dialect: Dialect): string[][] {
  return parseCommands(input, dialect)
    .map((command) => [...command.words])
    .filter((words) => words.length > 0);
}

/**
 * Splits `text` into simple commands: words with quotes and escapes removed, redirections and
 * wrappers (`sudo`, `env`, ...) dropped, and leading `NAME=value` words kept apart.
 */
export function parseCommands(input: string, dialect: Dialect): SimpleCommand[] {
  const text = input.replaceAll('\r\n', '\n');
  const escape = dialect === 'bash' ? '\\' : '`';
  const commands: SimpleCommand[] = [];
  let words: Word[] = [];
  let word: Word | undefined;
  const endWord = (): void => {
    if (word !== undefined) words.push(word);
    word = undefined;
  };
  const endCommand = (): void => {
    endWord();
    const command = finish(words);
    if (command.words.length > 0 || command.assignments.length > 0) commands.push(command);
    words = [];
  };
  for (let i = 0; i < text.length; i++) {
    const char = text.charAt(i);
    const next = text.charAt(i + 1);
    if (char === escape) {
      // Escaped newline continues the line; any other escaped character is literal.
      if (next !== '\n') word = { text: (word?.text ?? '') + next, quoted: word?.quoted ?? false };
      i++;
    } else if (char === "'" || char === '"') {
      const [value, end] = readQuoted(text, i, dialect);
      word = { text: (word?.text ?? '') + value, quoted: true };
      i = end;
    } else if (char === '\n') {
      endCommand();
    } else if (/\s/.test(char)) {
      endWord();
    } else if (char === '#' && word === undefined) {
      const newline = text.indexOf('\n', i);
      i = newline === -1 ? text.length : newline - 1;
    } else if (char === '&' && (text.charAt(i - 1) === '>' || next === '>')) {
      word = { text: (word?.text ?? '') + char, quoted: word?.quoted ?? false };
    } else if (SEPARATORS.has(char) || (dialect === 'bash' && char === '`')) {
      endCommand();
    } else if ((char === '{' || char === '}') && word === undefined && /^[\s;|&()]?$/.test(next)) {
      endCommand();
    } else {
      word = { text: (word?.text ?? '') + char, quoted: word?.quoted ?? false };
    }
  }
  endCommand();
  return commands;
}
