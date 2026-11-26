// Skipping over JavaScript string and regex literals for the comment scanner (comments.ts).

/** Index after the quoted string starting at `start`; an unterminated one ends before the newline. */
export function skipString(source: string, start: number): number {
  const quote = source[start];
  let i = start + 1;
  while (i < source.length && source[i] !== quote && source[i] !== '\n') {
    i += source[i] === '\\' ? 2 : 1;
  }
  return source[i] === quote ? i + 1 : i;
}

/**
 * Index after the regex literal starting at `start` and its flags, or -1 if the line or the
 * source ends first, which means the `/` was a division after all.
 */
export function skipRegex(source: string, start: number): number {
  let inClass = false;
  for (let i = start + 1; i < source.length; i++) {
    const char = source[i];
    if (char === '\n') return -1;
    if (char === '\\') {
      i++;
    } else if (char === '[' || char === ']') {
      inClass = char === '[';
    } else if (char === '/' && !inClass) {
      let end = i + 1;
      while (/[a-z]/i.test(source.charAt(end))) end++;
      return end;
    }
  }
  return -1;
}
