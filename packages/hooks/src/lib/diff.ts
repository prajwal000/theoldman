import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AddedLine } from './added-lines.js';
import { splitLines } from './added-lines.js';
import { runGit } from './git.js';

export interface DiffFile {
  /** Relative to the directory the diff was taken in, with forward slashes. */
  readonly path: string;
  readonly status: 'added' | 'modified' | 'deleted';
  /** Added lines, numbered as in the new file. */
  readonly addedLines: readonly AddedLine[];
  /** How many lines the change removed. */
  readonly removedLines: number;
}

// Repository config is untrusted: diff.external and textconv drivers run programs, and
// noprefix, mnemonicPrefix and quotePath change the output this file parses.
const DIFF_ARGS = [
  '-c',
  'core.quotepath=false',
  'diff',
  '--no-ext-diff',
  '--no-textconv',
  '--no-color',
  '--no-renames',
  '--relative',
  '--src-prefix=a/',
  '--dst-prefix=b/',
];
// Untracked files bigger than this are listed as binary rather than read whole.
const MAX_UNTRACKED_BYTES = 1024 * 1024;

/** A new-file diff for the untracked `path` in `cwd`; empty if it can no longer be read. */
export function newFileDiff(cwd: string, path: string): string {
  const header = `diff --git a/${path} b/${path}\nnew file mode 100644\n`;
  let content: string;
  try {
    const buffer = readFileSync(join(cwd, path));
    if (buffer.length > MAX_UNTRACKED_BYTES || buffer.includes(0)) {
      return `${header}Binary files /dev/null and b/${path} differ\n`;
    }
    content = buffer.toString('utf8');
  } catch {
    // Gone or unreadable since git listed it: there is nothing to show.
    return '';
  }
  const lines = splitLines(content);
  if (lines.length === 0) return header;
  const body = lines.map((line) => `+${line}\n`).join('');
  return `${header}--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${String(lines.length)} @@\n${body}`;
}

/**
 * The changes in `cwd` against HEAD, staged or not, as a unified diff with paths relative to
 * `cwd`. Untracked files that are not ignored are included as new files. In a repository
 * with no commits yet, staged files count as new. With `paths`, only those files or folders
 * (relative to `cwd`, matched literally) are included. `base` is the commit to compare with,
 * a full hash from git itself. Throws outside a git repository.
 */
export function workingTreeDiff(cwd: string, paths?: readonly string[], base = 'HEAD'): string {
  if (paths?.length === 0) return '';
  // `:(literal)` keeps a name such as `*.ts` from being read as a pattern.
  const pathspecs = ['--', ...(paths ?? []).map((path) => `:(literal)${path}`)];
  let tracked: string;
  try {
    tracked = runGit(cwd, [...DIFF_ARGS, base, ...pathspecs]);
  } catch (error) {
    if (base !== 'HEAD') throw error;
    // No HEAD yet: compare the index with the empty tree instead.
    tracked = runGit(cwd, [...DIFF_ARGS, '--cached', ...pathspecs]);
  }
  const untracked = runGit(cwd, ['ls-files', '--others', '--exclude-standard', '-z', ...pathspecs])
    .split('\0')
    .filter((path) => path !== '');
  return tracked + untracked.map((path) => newFileDiff(cwd, path)).join('');
}

function unquote(path: string): string {
  if (!path.startsWith('"')) return path;
  const bytes: number[] = [];
  const body = path.slice(1, -1);
  for (let i = 0; i < body.length; i++) {
    const char = body.charAt(i);
    if (char !== '\\') {
      bytes.push(...Buffer.from(char, 'utf8'));
      continue;
    }
    const octal = /^[0-7]{3}/.exec(body.slice(i + 1))?.[0];
    const escapes: Record<string, number> = { n: 10, t: 9, '"': 34, '\\': 92 };
    bytes.push(octal === undefined ? (escapes[body.charAt(i + 1)] ?? 92) : parseInt(octal, 8));
    i += octal === undefined ? 1 : 3;
  }
  return Buffer.from(bytes).toString('utf8');
}

function filePath(line: string, prefix: string): string {
  return unquote(line.slice(4).replace(/\t$/, '')).slice(prefix.length);
}

/** The files and added lines of a unified diff from `git diff` or `workingTreeDiff`. */
export function parseDiff(diff: string): DiffFile[] {
  const files: {
    path: string;
    status: DiffFile['status'];
    addedLines: AddedLine[];
    removedLines: number;
  }[] = [];
  let current: (typeof files)[number] | undefined;
  // Header lines come before a file's first hunk; inside hunks, `+++ x` is an added line.
  let inHunk = false;
  let next = 0;
  for (const line of splitLines(diff)) {
    if (line.startsWith('diff --git ')) {
      // Without renames both sides name the same path: `a/<path> b/<path>`.
      const rest = line.slice('diff --git '.length);
      const path = unquote(rest.slice(0, (rest.length - 1) / 2)).slice(2);
      current = { path, status: 'modified', addedLines: [], removedLines: 0 };
      files.push(current);
      inHunk = false;
    } else if (current === undefined) {
      continue;
    } else if (line.startsWith('@@')) {
      next = Number(/^@@ -\S+ \+(\d+)/.exec(line)?.[1] ?? '1');
      inHunk = true;
    } else if (inHunk) {
      if (line.startsWith('+')) current.addedLines.push({ line: next, text: line.slice(1) });
      if (line.startsWith('+') || line.startsWith(' ')) next += 1;
      if (line.startsWith('-')) current.removedLines += 1;
    } else if (line.startsWith('new file mode')) {
      current.status = 'added';
    } else if (line.startsWith('deleted file mode')) {
      current.status = 'deleted';
    } else if (line.startsWith('--- a/') || line.startsWith('--- "a/')) {
      current.path = filePath(line, 'a/');
    } else if (line.startsWith('+++ b/') || line.startsWith('+++ "b/')) {
      current.path = filePath(line, 'b/');
    }
  }
  return files;
}
