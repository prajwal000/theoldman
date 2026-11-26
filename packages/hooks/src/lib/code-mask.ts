import { scanJs } from './js-scan.js';

/**
 * `source` with everything that is not code blanked out: strings, template-literal text, regex
 * literals and, unless `keepComments` is set, comments. Characters become spaces and line breaks
 * stay, so offsets and line numbers still match the original. `${...}` expressions are kept.
 */
export function maskJs(source: string, file = '', { keepComments = false } = {}): string {
  let masked = '';
  let position = 0;
  for (const span of scanJs(source, file)) {
    if (keepComments && span.kind.endsWith('comment')) continue;
    masked +=
      source.slice(position, span.start) +
      source.slice(span.start, span.end).replace(/[^\n]/g, ' ');
    position = span.end;
  }
  return masked + source.slice(position);
}
