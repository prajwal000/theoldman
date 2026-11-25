import { readHeadVersion } from './git.js';
import type { EditToolInput } from './input.js';

export interface AddedLine {
  /** 1-based line number in the new content. */
  readonly line: number;
  readonly text: string;
}

// The LCS table costs 2 bytes per cell. Past this size (about a 2,200 x 2,200 line change) a
// linear approximation is used instead, so a huge rewrite cannot exhaust memory or time.
const MAX_LCS_CELLS = 5_000_000;

/** Splits on LF or CRLF so both line endings give the same lines; a final newline adds no line. */
export function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

/** Counts each old line once; a new line is added when no unused old copy of it is left. */
function addedByCount(oldLines: readonly string[], newLines: readonly string[]): number[] {
  const unused = new Map<string, number>();
  for (const line of oldLines) unused.set(line, (unused.get(line) ?? 0) + 1);
  const added: number[] = [];
  newLines.forEach((line, index) => {
    const count = unused.get(line) ?? 0;
    if (count > 0) {
      unused.set(line, count - 1);
    } else {
      added.push(index);
    }
  });
  return added;
}

/** Indices of `newLines` that are not part of a longest common subsequence with `oldLines`. */
function addedByLcs(oldLines: readonly string[], newLines: readonly string[]): number[] {
  const ids = new Map<string, number>();
  const intern = (lines: readonly string[]): Int32Array =>
    Int32Array.from(lines, (line) => {
      const id = ids.get(line) ?? ids.size;
      ids.set(line, id);
      return id;
    });
  const a = intern(oldLines);
  const b = intern(newLines);
  const width = b.length + 1;
  const table = new Uint16Array((a.length + 1) * width);
  const at = (i: number, j: number): number => table[i * width + j] ?? 0;
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * width + j] =
        a[i] === b[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }
  const added: number[] = [];
  let i = 0;
  for (let j = 0; j < b.length;) {
    if (i < a.length && a[i] === b[j]) {
      i++;
      j++;
    } else if (i < a.length && at(i + 1, j) >= at(i, j + 1)) {
      i++;
    } else {
      added.push(j);
      j++;
    }
  }
  return added;
}

/** Lines of `newText` that are not in `oldText`, by line diff. */
export function diffAddedLines(oldText: string, newText: string): AddedLine[] {
  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);
  let start = 0;
  while (
    start < oldLines.length &&
    start < newLines.length &&
    oldLines[start] === newLines[start]
  ) {
    start++;
  }
  let oldEnd = oldLines.length;
  let newEnd = newLines.length;
  while (oldEnd > start && newEnd > start && oldLines[oldEnd - 1] === newLines[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }
  const oldMiddle = oldLines.slice(start, oldEnd);
  const newMiddle = newLines.slice(start, newEnd);
  const indices =
    (oldMiddle.length + 1) * (newMiddle.length + 1) > MAX_LCS_CELLS
      ? addedByCount(oldMiddle, newMiddle)
      : addedByLcs(oldMiddle, newMiddle);
  return indices.map((index) => ({ line: start + index + 1, text: newMiddle[index] ?? '' }));
}

/** Added lines of a Write: the new content compared with the file at HEAD, if it has one. */
export function addedLinesForWrite(filePath: string, content: string): AddedLine[] {
  return diffAddedLines(readHeadVersion(filePath) ?? '', content);
}

/**
 * Added lines of an Edit, from `old_string` and `new_string`. With the edited file's content,
 * line numbers and text refer to the whole file line; without it, to lines of `new_string`.
 * With `replace_all`, only the first occurrence is located.
 */
export function addedLinesForEdit(edit: EditToolInput, fileContent?: string): AddedLine[] {
  const added = diffAddedLines(edit.old_string, edit.new_string);
  if (fileContent === undefined || added.length === 0) return added;
  const file = fileContent.replaceAll('\r\n', '\n');
  const index = file.indexOf(edit.new_string.replaceAll('\r\n', '\n'));
  if (index === -1) return added;
  const offset = file.slice(0, index).split('\n').length - 1;
  const fileLines = splitLines(file);
  return added.map(({ line }) => ({
    line: line + offset,
    text: fileLines[line + offset - 1] ?? '',
  }));
}
