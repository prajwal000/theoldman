import { describe, expect, it } from 'vitest';
import { formatCents } from './money';

describe('formatCents', () => {
  it('formats minor units as dollars', () => {
    expect(formatCents(1999)).toBe('$19.99');
  });

  it('formats zero and whole amounts', () => {
    expect(formatCents(0)).toBe('$0.00');
    expect(formatCents(500)).toBe('$5.00');
  });
});
