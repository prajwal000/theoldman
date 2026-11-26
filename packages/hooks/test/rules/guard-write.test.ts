import { describe, expect, it } from 'vitest';
import {
  checkAgentPath,
  checkPath,
  DOCS_WRITER,
  docsWriterRule,
  guardWriteRule,
  isDocPath,
} from '../../src/rules/guard-write.js';
import { runRuleOnFixtures } from '../harness.js';

runRuleOnFixtures('OLDMAN-G05', guardWriteRule());
runRuleOnFixtures('OLDMAN-G06', guardWriteRule());
runRuleOnFixtures('OLDMAN-G07', docsWriterRule('/home/me/proj'));

describe('checkAgentPath', () => {
  it('blocks the docs writer outside documentation files, naming the path', () => {
    expect(checkAgentPath('/home/me/proj/src/a.ts', '/home/me/proj', DOCS_WRITER)).toEqual({
      id: 'OLDMAN-G07',
      message:
        '/home/me/proj/src/a.ts is not a documentation file. The docs writer may only change README and CHANGELOG files, Markdown under docs/, .env.example and OpenAPI files. Describe the code change in your reply instead of making it.',
    });
  });

  it('takes a relative path from cwd and quotes it as given', () => {
    const fromDocs = checkAgentPath('..\\src\\a.ts', 'C:\\Repo', DOCS_WRITER, 'C:\\Repo\\docs');
    expect(fromDocs?.message).toMatch(/^\.\.\\src\\a\.ts is not a documentation file\./);
    expect(checkAgentPath('adr/0001.md', 'C:\\Repo', DOCS_WRITER, 'C:\\Repo\\docs')).toBe(
      undefined,
    );
  });

  it('leaves the main agent and every other agent alone', () => {
    expect(checkAgentPath('src/a.ts', '/home/me/proj', undefined)).toBeUndefined();
    expect(checkAgentPath('src/a.ts', '/home/me/proj', 'theoldman:oldman-reviewer')).toBe(
      undefined,
    );
    expect(checkAgentPath('src/a.ts', '/home/me/proj', 'oldman-docs-writer')).toBeUndefined();
  });
});

describe('isDocPath', () => {
  it('handles Windows and Git Bash project roots, case-insensitively', () => {
    expect(isDocPath('C:\\Repo\\docs\\adr\\0001.md', 'c:/repo')).toBe(true);
    expect(isDocPath('/c/repo/README.md', 'C:\\Repo')).toBe(true);
    expect(isDocPath('C:\\Repo\\src\\a.ts', 'C:\\Repo')).toBe(false);
    expect(isDocPath('D:\\other\\README.md', 'C:\\Repo')).toBe(false);
  });

  it('refuses the project root itself and paths that climb out of it', () => {
    expect(isDocPath('/home/me/proj', '/home/me/proj')).toBe(false);
    expect(isDocPath('docs/../../proj2/docs/a.md', '/home/me/proj')).toBe(false);
  });
});

describe('checkPath', () => {
  it('names the rule, the path and the safe alternative', () => {
    expect(checkPath('apps\\web\\.env')).toEqual({
      id: 'OLDMAN-G05',
      message:
        'apps\\web\\.env is an env file and can hold real secrets. Add the variable name to .env.example instead, and ask the user to put the value in their own env file.',
    });
    expect(checkPath('C:\\Users\\me\\.ssh\\id_rsa')?.message).toContain(
      'Do not create or change key files; ask the user to manage them.',
    );
  });

  it('allows ordinary files and an empty path', () => {
    expect(checkPath('src/index.ts')).toBeUndefined();
    expect(checkPath('')).toBeUndefined();
  });

  it('skips blank lines in fixtures', () => {
    const rule = guardWriteRule();
    expect(rule({ file: 'x.txt', content: '\n', addedLines: [{ line: 1, text: '  ' }] })).toEqual(
      [],
    );
  });
});
