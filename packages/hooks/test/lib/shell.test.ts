import { describe, expect, it } from 'vitest';
import { parseCommands, programName, splitCommands } from '../../src/lib/shell.js';

describe('parseCommands', () => {
  it('keeps leading assignments apart, including assignment-only commands', () => {
    expect(parseCommands('A=1 B=x sudo C=2 npx prisma; D=3', 'bash')).toEqual([
      { assignments: ['A=1', 'B=x', 'C=2'], words: ['npx', 'prisma'] },
      { assignments: ['D=3'], words: [] },
    ]);
  });
});

describe('programName', () => {
  it.each([
    ['git', 'git'],
    ['/usr/bin/git', 'git'],
    ['C:\\Program Files\\Git\\cmd\\git.exe', 'git'],
    ['GIT.EXE', 'git'],
    ['npm.cmd', 'npm'],
    ['run.bat', 'run'],
  ])('%s -> %s', (word, name) => {
    expect(programName(word)).toBe(name);
  });
});

describe('splitCommands (bash)', () => {
  const split = (text: string): string[][] => splitCommands(text, 'bash');

  it('splits on ; && || | & newlines and parentheses', () => {
    expect(split('a 1; b 2 && c || d | e & f\ng (h) $(i)')).toEqual([
      ['a', '1'],
      ['b', '2'],
      ['c'],
      ['d'],
      ['e'],
      ['f'],
      ['g'],
      ['h'],
      ['$'],
      ['i'],
    ]);
  });

  it('splits on standalone braces and backticks but not on braces inside words', () => {
    expect(split('{ a; } && echo ${HOME} `b`')).toEqual([['a'], ['echo', '${HOME}'], ['b']]);
  });

  it('removes quotes and keeps quoted text as one word', () => {
    expect(split(`echo "git push -f origin main" 'a b' "x"'y'z`)).toEqual([
      ['echo', 'git push -f origin main', 'a b', 'xyz'],
    ]);
  });

  it('handles escapes inside and outside double quotes', () => {
    expect(split('echo "a \\"b\\" \\$c \\n" d\\ e \\;')).toEqual([
      ['echo', 'a "b" $c \\n', 'd e', ';'],
    ]);
  });

  it('joins a line continued with a backslash, including CRLF', () => {
    expect(split('git push \\\n  -f origin main')).toEqual([
      ['git', 'push', '-f', 'origin', 'main'],
    ]);
    expect(split('git push \\\r\n-f')).toEqual([['git', 'push', '-f']]);
    expect(split('echo "a\\\nb"')).toEqual([['echo', 'ab']]);
  });

  it('skips comments but not # inside a word', () => {
    expect(split('a # git push -f origin main\nb c#d')).toEqual([['a'], ['b', 'c#d']]);
    expect(split('# only a comment')).toEqual([]);
  });

  it('drops redirections and their targets', () => {
    expect(split('a > out.txt b 2>&1 c >>log 2> err d < in e &>all f')).toEqual([
      ['a', 'b', 'c', 'd', 'e', 'f'],
    ]);
    expect(split('echo ">" x')).toEqual([['echo', '>', 'x']]);
  });

  it('drops leading assignments and wrappers with their flags', () => {
    expect(split('FOO=1 BAR=x git status')).toEqual([['git', 'status']]);
    expect(split('sudo -E env A=1 nohup time git push')).toEqual([['git', 'push']]);
    expect(split('FOO=1')).toEqual([]);
  });

  it('keeps going after an unterminated quote', () => {
    expect(split('echo "unterminated; git push')).toEqual([['echo', 'unterminated; git push']]);
  });

  it('treats a trailing escape as nothing', () => {
    expect(split('a\\')).toEqual([['a']]);
  });
});

describe('splitCommands (PowerShell)', () => {
  const split = (text: string): string[][] => splitCommands(text, 'powershell');

  it('splits $env: assignments and the call operator off as their own commands', () => {
    expect(split('$env:FOO=1; & git push -f')).toEqual([['$env:FOO=1'], ['git', 'push', '-f']]);
  });

  it('reads \'\' and "" as literal quotes and the backtick as the escape', () => {
    expect(split(`Write-Output 'it''s' "say ""hi"" \`"x\`"" a\`;b`)).toEqual([
      ['Write-Output', "it's", 'say "hi" "x"', 'a;b'],
    ]);
  });

  it('keeps backslashes in Windows paths', () => {
    expect(split("& 'C:\\Program Files\\Git\\cmd\\git.exe' push")).toEqual([
      ['C:\\Program Files\\Git\\cmd\\git.exe', 'push'],
    ]);
    expect(split('Remove-Item C:\\temp\\x')).toEqual([['Remove-Item', 'C:\\temp\\x']]);
  });

  it('continues a line ending in a backtick', () => {
    expect(split('git push `\n -f')).toEqual([['git', 'push', '-f']]);
  });

  it('splits script blocks', () => {
    expect(split('if ($x) { git push -f origin main }')).toEqual([
      ['if'],
      ['$x'],
      ['git', 'push', '-f', 'origin', 'main'],
    ]);
  });
});
