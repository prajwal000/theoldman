import { describe, it } from 'vitest';

// Cases the comment extractor gets wrong because it scans tokens instead of parsing. Each is rare
// in real code; turn one into a real test if it starts causing false findings.
describe('comment extractor known gaps', () => {
  it.todo('JSX text that contains // or /*, as in <p>http://example.com</p>, is read as a comment');
  it.todo(
    'a regex right after a closing parenthesis, as in if (ok) /x\\/\\/y/.test(s), is read as division',
  );
  it.todo(
    'a division right after a closing brace, as in class A {} / 2, is read as the start of a regex',
  );
  it.todo(
    'a property named like a keyword, as in a.in / 2 / 3, makes the following / start a regex',
  );
  it.todo('a regex right after a less-than sign, as in a < /x/.test(s), is read as division');
  it.todo('HTML-like comments (<!-- and -->) in classic scripts are not recognised');
  it.todo(
    'identifiers with non-ASCII letters are read one character at a time (harmless for comments)',
  );
});
