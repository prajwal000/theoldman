import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { expandCommands, resolveTarget } from '../../src/rules/command-expand.js';
import { COMMIT_OPTIONS, longOption, PUSH_OPTIONS } from '../../src/rules/git-options.js';
import { nestedCommand } from '../../src/rules/nested.js';
import { unwrap } from '../../src/rules/wrappers.js';
import { fakeContext } from './fake-context.js';

const encode = (text: string): string => Buffer.from(text, 'utf16le').toString('base64');

describe('longOption', () => {
  it.each([
    ['--force', PUSH_OPTIONS, 'force'],
    ['--force-w', PUSH_OPTIONS, 'force-with-lease'],
    ['--force-w=main:abc', PUSH_OPTIONS, 'force-with-lease'],
    ['--forc', PUSH_OPTIONS, undefined],
    ['--no-verif', PUSH_OPTIONS, 'no-verify'],
    ['--no-v', PUSH_OPTIONS, undefined],
    ['--mir', PUSH_OPTIONS, 'mirror'],
    ['--del', PUSH_OPTIONS, 'delete'],
    ['--no-force', PUSH_OPTIONS, 'no-force'],
    ['--mess', COMMIT_OPTIONS, 'message'],
    ['--no-veri', COMMIT_OPTIONS, 'no-verify'],
    ['--bogus', COMMIT_OPTIONS, undefined],
    ['--', COMMIT_OPTIONS, undefined],
  ])('%s -> %s', (arg, known, expected) => {
    expect(longOption(arg, known)).toBe(expected);
  });
});

describe('nestedCommand', () => {
  it.each([
    [['bash', '-c', 'git status'], 'git status', 'bash'],
    [['/bin/sh', '-ec', 'a; b'], 'a; b', 'bash'],
    [['zsh', '-o', 'pipefail', '-lc', 'x'], 'x', 'bash'],
    [['bash', '--norc', '-c', 'x', 'arg0'], 'x', 'bash'],
    [['cmd', '/C', 'git', 'push'], 'git push', 'powershell'],
    [['cmd.exe', '/s', '/k', 'dir'], 'dir', 'powershell'],
    [['pwsh', '-NoLogo', '-co', 'Get-Item', 'x'], 'Get-Item x', 'powershell'],
    [['powershell', '-WindowStyle', 'Hidden', '-Command', 'a'], 'a', 'powershell'],
    [['powershell', 'git', 'status'], 'git status', 'powershell'],
    [['pwsh', '-e', encode('git status')], 'git status', 'powershell'],
    [['pwsh', '-EncodedCommand', encode('rm x')], 'rm x', 'powershell'],
  ] as const)('%j runs %j', (words, text, dialect) => {
    expect(nestedCommand(words)).toEqual({ text, dialect });
  });

  it.each([
    [['bash', 'deploy.sh']],
    [['bash', '-c']],
    [['bash', '-x', '-o']],
    [['cmd', '/q']],
    [['cmd', '/c', '  ']],
    [['pwsh', 'deploy.ps1']],
    [['pwsh', '-File', 'x.ps1']],
    [['pwsh', '-ec', 'not base64!']],
    [['pwsh', '-ec']],
    [['pwsh', '-NoProfile']],
    [['git', '-c', 'x']],
  ])('finds no command string in %j', (words) => {
    expect(nestedCommand(words)).toBeUndefined();
  });
});

describe('unwrap', () => {
  const scripts = new Set(['build', 'db:reset']);
  const isScript = (name: string): boolean => scripts.has(name);

  it.each([
    [
      ['npx', '-y', '--package=prisma', 'prisma', 'migrate'],
      ['prisma', 'migrate'],
    ],
    [
      ['npx', '-p', 'prisma', 'prisma', 'x'],
      ['prisma', 'x'],
    ],
    [['bunx', 'prisma'], ['prisma']],
    [['npm', 'exec', '--', 'prisma'], ['prisma']],
    [['pnpm', 'dlx', 'prisma'], ['prisma']],
    [['yarn', 'exec', 'prisma'], ['prisma']],
    [['bun', 'x', 'prisma'], ['prisma']],
    [['pnpm', 'exec', 'npx', 'prisma'], ['prisma']],
    [
      ['yarn', 'prisma', 'migrate'],
      ['prisma', 'migrate'],
    ],
    [['pnpm', 'install'], ['install']],
    [
      ['npm', 'install'],
      ['npm', 'install'],
    ],
    [
      ['git', 'push'],
      ['git', 'push'],
    ],
  ])('%j runs %j', (words, expected) => {
    expect(unwrap(words, isScript)).toEqual({ kind: 'command', words: expected });
  });

  it.each([
    [['npm', 'run', 'build'], 'build'],
    [['npm', 'run-script', '--silent', 'build'], 'build'],
    [['pnpm', 'run', 'db:reset'], 'db:reset'],
    [['yarn', 'db:reset'], 'db:reset'],
    [['pnpm', 'build'], 'build'],
    [['bun', 'run', 'build'], 'build'],
    [['npm', 'test'], 'test'],
    [['npm', 't'], 'test'],
    [['yarn', 'start'], 'start'],
  ])('%j runs the script %s', (words, name) => {
    expect(unwrap(words, isScript)).toEqual({ kind: 'script', name });
  });

  it('leaves a run without a script name and bun test alone', () => {
    expect(unwrap(['npm', 'run'], isScript)).toEqual({ kind: 'command', words: ['npm', 'run'] });
    expect(unwrap(['bun', 'test'], isScript)).toEqual({ kind: 'command', words: ['bun', 'test'] });
  });
});

describe('expandCommands', () => {
  const cwds = (text: string, dialect: 'bash' | 'powershell' = 'bash'): (string | undefined)[] =>
    expandCommands(text, dialect, fakeContext({ cwd: '/home/me/proj', home: '/home/me' }).context)
      .flatMap((unit) => unit.commands)
      .map((command) => command.cwd);

  it('follows cd, pushd and popd along the line', () => {
    expect(cwds('ls; cd src && ls; pushd /tmp; ls; popd; ls; cd; ls; cd -; ls')).toEqual([
      '/home/me/proj',
      '/home/me/proj/src',
      '/tmp',
      '/home/me/proj/src',
      '/home/me',
      undefined,
    ]);
  });

  it('follows Set-Location with -Path, and ignores a bare Set-Location', () => {
    expect(cwds('Set-Location -Path C:\\x; ls; Set-Location; ls; popd; ls', 'powershell')).toEqual([
      'c:/x',
      'c:/x',
      'c:/x',
    ]);
  });

  it("follows cmd's cd /d inside cmd /c", () => {
    expect(cwds('cmd /c "cd /d D:\\data && dir"')).toEqual(['/home/me/proj', 'd:/data']);
  });

  it('cannot follow a cd into a variable', () => {
    expect(cwds('cd "$DIR" && ls && cd sub && ls && cd /abs && ls')).toEqual([
      undefined,
      undefined,
      '/abs',
    ]);
  });

  it('passes variables set on the line to nested commands and scripts', () => {
    const units = expandCommands(
      '$env:A = "1"; pwsh -c "echo $env:A"',
      'powershell',
      fakeContext().context,
    );
    expect(units.map((unit) => unit.variables.get('A'))).toEqual(['1', '1']);
  });

  it('stops following shells nested too deep', () => {
    let line = 'git push -f origin main';
    for (let i = 0; i < 6; i++) line = `bash -c ${JSON.stringify(line)}`;
    expect(expandCommands(line, 'bash', fakeContext().context)).toHaveLength(5);
  });

  it('reads package.json scripts only when a script is run, once per directory', () => {
    const { context, calls } = fakeContext();
    expandCommands('npm run build && npm run clean && git status', 'bash', context);
    expect(calls.filter((call) => call.startsWith('packageScripts'))).toEqual([
      'packageScripts C:\\repo',
    ]);
  });

  it('skips scripts when there is no package.json or no known directory', () => {
    const noScripts = { ...fakeContext().context, packageScripts: () => undefined };
    expect(expandCommands('npm run build', 'bash', noScripts)).toHaveLength(1);
    expect(expandCommands('cd "$X" && npm run build', 'bash', fakeContext().context)).toHaveLength(
      1,
    );
  });
});

describe('resolveTarget', () => {
  it('needs a known directory for relative paths but not for absolute ones', () => {
    expect(resolveTarget('dist', undefined, '/home/me')).toBeUndefined();
    expect(resolveTarget('/etc', undefined, '/home/me')).toBe('/etc');
    expect(resolveTarget('C:\\x', undefined, '/home/me')).toBe('c:/x');
    expect(resolveTarget('~/x', undefined, '/home/me')).toBe('/home/me/x');
  });
});
