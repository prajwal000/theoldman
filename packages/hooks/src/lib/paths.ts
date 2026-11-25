/**
 * Puts a path in one form: forward slashes, and a lower-case `c:` drive whether the input was
 * `C:\`, `C:/` or the Git Bash form `/c/`.
 */
export function normalizePath(path: string): string {
  return path
    .replaceAll('\\', '/')
    .replace(/^\/([A-Za-z])(?=\/|$)/, '$1:')
    .replace(/^([A-Za-z]):/, (drive) => drive.toLowerCase())
    .replace(/^\.\//, '');
}

/** The path relative to the project root, or the normalized path if it is outside the root. */
export function toProjectRelative(filePath: string, projectDir: string): string {
  const file = normalizePath(filePath);
  const root = normalizePath(projectDir).replace(/\/+$/, '');
  // Windows paths are case-insensitive, so `C:\Proj` and `c:/proj` are the same root.
  const fold = /^[a-z]:/.test(root) ? (p: string) => p.toLowerCase() : (p: string) => p;
  return fold(file).startsWith(`${fold(root)}/`) ? file.slice(root.length + 1) : file;
}

/**
 * `target` made absolute against `base` and normalized, with `.` and `..` resolved. Works on
 * Windows-style paths on any OS, unlike node:path, because hook input can come from either.
 */
export function resolvePath(target: string, base: string): string {
  const path = normalizePath(target);
  const absolute =
    /^[a-z]:/.test(path) || path.startsWith('/')
      ? path
      : `${normalizePath(base).replace(/\/+$/, '')}/${path}`;
  const [, prefix = '', rest = ''] = /^((?:[a-z]:)?\/?)(.*)$/s.exec(absolute) ?? [];
  const parts: string[] = [];
  for (const part of rest.split('/')) {
    if (part === '..') {
      parts.pop();
    } else if (part !== '' && part !== '.') {
      parts.push(part);
    }
  }
  return prefix + parts.join('/');
}

/** True when `path` is strictly below `root`; drive paths compare case-insensitively. */
export function isStrictlyInside(path: string, root: string): boolean {
  const base = resolvePath(root, '/').replace(/\/$/, '');
  const fold = /^[a-z]:/.test(base) ? (p: string) => p.toLowerCase() : (p: string) => p;
  const full = fold(resolvePath(path, base));
  return full.startsWith(`${fold(base)}/`) && full.length > base.length + 1;
}

/** Supports `*` (within one segment), `?` (one character) and `**` (any number of segments). */
export function globToRegExp(glob: string): RegExp {
  const pattern = normalizePath(glob);
  let source = '';
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern.charAt(i);
    if (char === '*' && pattern.charAt(i + 1) === '*') {
      const slash = pattern.charAt(i + 2) === '/';
      source += slash ? '(?:.*/)?' : '.*';
      i += slash ? 2 : 1;
    } else if (char === '*') {
      source += '[^/]*';
    } else if (char === '?') {
      source += '[^/]';
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${source}$`);
}

export function isIgnored(
  filePath: string,
  projectDir: string,
  patterns: readonly string[],
): boolean {
  const relative = toProjectRelative(filePath, projectDir);
  return patterns.some((pattern) => globToRegExp(pattern).test(relative));
}
