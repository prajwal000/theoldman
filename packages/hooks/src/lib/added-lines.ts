import { readHeadVersion } from './git.js';
import type { EditToolInput } from './input.js';

export interface AddedLine {
  /** 1-based line number in the new content. */
  readonly line: number;
  readonly text: string;
}

// The LCS table costs 2 bytes per cell and quadratic time. Past this size (about 1,400 x 1,400
// reordered lines) a linear approximation is used instead, so diffing stays well under 300 ms.
const MAX_LCS_CELLS = 2_000_000;

/** Splits on LF or CRLF so both line endings give the same lines; a final newline adds no line. */
export function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

/** Counts each old line once; a new line is unmatched when no unused old copy of it is left. */
function unmatchedByCount(a: readonly number[], b: readonly number[]): number[] {
  const unused = new Map<number, number>();
  for (const id of a) unused.set(id, (unused.get(id) ?? 0) + 1);
  const unmatched: number[] = [];
  b.forEach((id, index) => {
    const count = unused.get(id) ?? 0;
    if (count > 0) {
      unused.set(id, count - 1);
    } else {
      unmatched.push(index);
    }
  });
  return unmatched;
}

/** Indices of `b` that are not part of a longest common subsequence with `a`. */
function unmatchedByLcs(a: readonly number[], b: readonly number[]): number[] {
  const width = b.length + 1;
  const table = new Uint16Array((a.length + 1) * width);
  const at = (index: number): number => table[index] ?? 0;
  for (let i = a.length - 1; i >= 0; i--) {
    const row = i * width;
    const next = row + width;
    for (let j = b.length - 1; j >= 0; j--) {
      table[row + j] =
        a[i] === b[j] ? at(next + j + 1) + 1 : Math.max(at(next + j), at(row + j + 1));
    }
  }
  const unmatched: number[] = [];
  let i = 0;
  for (let j = 0; j < b.length;) {
    if (i < a.length && a[i] === b[j]) {
      i++;
      j++;
    } else if (i < a.length && at((i + 1) * width + j) >= at(i * width + j + 1)) {
      i++;
    } else {
      unmatched.push(j);
      j++;
    }
  }
  return unmatched;
}

/** Indices of `newLines` that a line diff against `oldLines` marks as added, in order. */
function addedIndices(oldLines: readonly string[], newLines: readonly string[]): number[] {
  const ids = new Map<string, number>();
  const idOf = (line: string): number => {
    const id = ids.get(line) ?? ids.size;
    ids.set(line, id);
    return id;
  };
  const oldIds = oldLines.map(idOf);
  const newIds = newLines.map(idOf);
  const inOld = new Set(oldIds);
  const inNew = new Set(newIds);
  // A line with no copy on the other side can never match, so it is decided here and kept out
  // of the diff. That removes every changed line of a typical edit and all of a rewrite.
  const added: number[] = [];
  const candidates: number[] = [];
  const b: number[] = [];
  newIds.forEach((id, index) => {
    if (inOld.has(id)) {
      candidates.push(index);
      b.push(id);
    } else {
      added.push(index);
    }
  });
  const a = oldIds.filter((id) => inNew.has(id));
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let aEnd = a.length;
  let bEnd = b.length;
  while (aEnd > start && bEnd > start && a[aEnd - 1] === b[bEnd - 1]) {
    aEnd--;
    bEnd--;
  }
  const aMiddle = a.slice(start, aEnd);
  const bMiddle = b.slice(start, bEnd);
  const unmatched =
    (aMiddle.length + 1) * (bMiddle.length + 1) > MAX_LCS_CELLS
      ? unmatchedByCount(aMiddle, bMiddle)
      : unmatchedByLcs(aMiddle, bMiddle);
  for (const index of unmatched) added.push(candidates[start + index] ?? 0);
  return added.sort((x, y) => x - y);
}

/** Lines of `newText` that are not in `oldText`, by line diff. */
export function diffAddedLines(oldText: string, newText: string): AddedLine[] {
  const newLines = splitLines(newText);
  return addedIndices(splitLines(oldText), newLines).map((index) => ({
    line: index + 1,
    text: newLines[index] ?? '',
  }));
}

/**
 * How many whole lines of `content` come before the first occurrence of `snippet`, so line N of
 * the snippet is line N + offset of the file; undefined if the snippet is not found.
 */
export function lineOffset(content: string, snippet: string): number | undefined {
  const file = content.replaceAll('\r\n', '\n');
  const index = file.indexOf(snippet.replaceAll('\r\n', '\n'));
  return index === -1 ? undefined : file.slice(0, index).split('\n').length - 1;
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
  const offset = lineOffset(fileContent, edit.new_string);
  if (offset === undefined) return added;
  const fileLines = splitLines(fileContent);
  return added.map(({ line }) => ({
    line: line + offset,
    text: fileLines[line + offset - 1] ?? '',
  }));
}
