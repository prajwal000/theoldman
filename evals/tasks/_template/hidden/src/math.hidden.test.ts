import { describe, expect, it } from 'vitest';
import { clamp } from './math';

describe('clamp', () => {
  it('keeps a value inside the range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it('limits a value to each end of the range', () => {
    expect(clamp(-3, 0, 10)).toBe(0);
    expect(clamp(42, 0, 10)).toBe(10);
  });

  it('throws a RangeError when min is greater than max', () => {
    expect(() => clamp(1, 10, 0)).toThrow(RangeError);
  });
});
