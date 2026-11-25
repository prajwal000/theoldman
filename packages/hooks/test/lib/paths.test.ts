import { describe, expect, it } from 'vitest';
import {
  globToRegExp,
  isIgnored,
  isStrictlyInside,
  normalizePath,
  resolvePath,
  toProjectRelative,
} from '../../src/lib/paths.js';

describe('normalizePath', () => {
  it.each([
    ['POSIX', '/home/me/proj/src/a.ts', '/home/me/proj/src/a.ts'],
    ['C:\\', 'C:\\proj\\src\\a.ts', 'c:/proj/src/a.ts'],
    ['C:/', 'C:/proj/src/a.ts', 'c:/proj/src/a.ts'],
    ['/c/', '/c/proj/src/a.ts', 'c:/proj/src/a.ts'],
    ['backslash relative', 'src\\a.ts', 'src/a.ts'],
    ['./ relative', './src/a.ts', 'src/a.ts'],
    ['bare /c drive', '/c', 'c:'],
  ])('%s', (_form, input, expected) => {
    expect(normalizePath(input)).toBe(expected);
  });

  it('does not treat a longer first POSIX segment as a drive', () => {
    expect(normalizePath('/cd/proj')).toBe('/cd/proj');
  });
});

describe('toProjectRelative', () => {
  it.each([
    ['POSIX', '/home/me/proj/src/generated/a.ts', '/home/me/proj'],
    ['C:\\', 'C:\\proj\\src\\generated\\a.ts', 'C:\\proj'],
    ['C:/', 'C:/proj/src/generated/a.ts', 'C:/proj'],
    ['/c/', '/c/proj/src/generated/a.ts', '/c/proj'],
    ['backslash relative', 'src\\generated\\a.ts', 'C:\\proj'],
    ['/c/ file under a C:\\ root', '/c/proj/src/generated/a.ts', 'C:\\proj'],
    ['C:\\ file under a /c/ root', 'C:\\proj\\src\\generated\\a.ts', '/c/proj/'],
    ['different drive-letter case', 'c:\\PROJ\\src\\generated\\a.ts', 'C:\\proj\\'],
  ])('%s', (_form, file, root) => {
    expect(toProjectRelative(file, root)).toBe('src/generated/a.ts');
  });

  it('keeps paths outside the root absolute and normalized', () => {
    expect(toProjectRelative('D:\\other\\a.ts', 'C:\\proj')).toBe('d:/other/a.ts');
    expect(toProjectRelative('/home/me/projector/a.ts', '/home/me/proj')).toBe(
      '/home/me/projector/a.ts',
    );
  });

  it('is case-sensitive for POSIX roots', () => {
    expect(toProjectRelative('/home/ME/proj/a.ts', '/home/me/proj')).toBe('/home/ME/proj/a.ts');
  });
});

describe('resolvePath', () => {
  it.each([
    ['dist', 'C:\\repo', 'c:/repo/dist'],
    ['.\\dist\\..\\out', 'C:\\repo\\', 'c:/repo/out'],
    ['../other', 'C:\\repo', 'c:/other'],
    ['../../../..', 'C:\\repo', 'c:/'],
    ['/etc', 'C:\\repo', '/etc'],
    ['/c/Windows', '/home/me', 'c:/Windows'],
    ['C:', 'C:\\repo', 'c:'],
    ['D:\\data\\.\\x', 'C:\\repo', 'd:/data/x'],
    ['src/./a', '/home/me/proj', '/home/me/proj/src/a'],
    ['..', '/', '/'],
  ])('%s against %s is %s', (target, base, expected) => {
    expect(resolvePath(target, base)).toBe(expected);
  });
});

describe('isStrictlyInside', () => {
  it.each([
    ['C:\\repo\\dist', 'C:\\repo', true],
    ['c:/REPO/dist', 'C:\\Repo\\', true],
    ['/c/repo/a/b', 'C:\\repo', true],
    ['C:\\repo', 'C:\\repo', false],
    ['C:\\repo2', 'C:\\repo', false],
    ['C:\\', 'C:\\repo', false],
    ['/home/me/proj/x', '/home/me/proj', true],
    ['/home/me/PROJ/x', '/home/me/proj', false],
    ['/home/me', '/home/me/proj', false],
  ])('%s in %s is %s', (path, root, expected) => {
    expect(isStrictlyInside(path, root)).toBe(expected);
  });
});

describe('globToRegExp', () => {
  it.each([
    ['**/generated/**', 'generated/a.ts', true],
    ['**/generated/**', 'src/deep/generated/x/a.ts', true],
    ['**/generated/**', 'src/generator/a.ts', false],
    ['**/*.lock', 'yarn.lock', true],
    ['**/*.lock', 'sub/Cargo.lock', true],
    ['**/*.lock', 'yarn.lockfile', false],
    ['src/*.ts', 'src/a.ts', true],
    ['src/*.ts', 'src/sub/a.ts', false],
    ['dist/**', 'dist/a/b/c.js', true],
    ['file?.ts', 'file1.ts', true],
    ['file?.ts', 'file/.ts', false],
    ['a.b+c(1).ts', 'a.b+c(1).ts', true],
    ['a.b+c(1).ts', 'aXb+c(1).ts', false],
    ['src\\*.ts', 'src/a.ts', true],
  ])('%s against %s is %s', (glob, path, expected) => {
    expect(globToRegExp(glob).test(path)).toBe(expected);
  });
});

describe('isIgnored', () => {
  const patterns = ['**/generated/**', '**/*.lock', '**/vendor/**'];

  it.each([
    ['/home/me/proj/src/generated/a.ts', '/home/me/proj'],
    ['C:\\proj\\src\\generated\\a.ts', 'C:\\proj'],
    ['C:/proj/src/generated/a.ts', 'C:/proj'],
    ['/c/proj/src/generated/a.ts', 'C:\\proj'],
    ['src\\generated\\a.ts', 'C:\\proj'],
  ])('ignores %s in %s', (file, root) => {
    expect(isIgnored(file, root, patterns)).toBe(true);
  });

  it('does not ignore other files or match with no patterns', () => {
    expect(isIgnored('C:\\proj\\src\\a.ts', 'C:\\proj', patterns)).toBe(false);
    expect(isIgnored('C:\\proj\\src\\generated\\a.ts', 'C:\\proj', [])).toBe(false);
  });

  it('still matches files outside the project root', () => {
    expect(isIgnored('D:\\libs\\vendor\\x.js', 'C:\\proj', patterns)).toBe(true);
  });
});
