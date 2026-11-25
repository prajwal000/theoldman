import { describe, expect, it } from 'vitest';

describe('hooks package', () => {
  it('loads the entry module', async () => {
    const entry: unknown = await import('../src/index.js');
    expect(entry).toBeTypeOf('object');
  });
});
