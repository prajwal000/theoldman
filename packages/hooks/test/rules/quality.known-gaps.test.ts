import { describe, it } from 'vitest';

// Cases the quality rules get wrong because the scanner treats JSX text as code. Turn one into a
// real test if it starts causing false findings.
describe('quality rules known gaps', () => {
  it.todo(
    'JSX text is read as code, so <p>use as any other</p> in a .tsx file is flagged by OLDMAN-Q01',
  );
  it.todo('JSX text such as <p>call console.log(x) to debug</p> is flagged by OLDMAN-Q02');
});
