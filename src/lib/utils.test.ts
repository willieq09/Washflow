import { describe, it, expect } from 'vitest';
import { formatCurrency } from './utils';

// The app shows money in Naira. These tests used to expect dollars, so they always failed.
// The non-breaking space some browsers put after ₦ is removed before comparing.
const fmt = (n: number) => formatCurrency(n).replace(/\u00a0/g, '');

describe('formatCurrency', () => {
  it('formats positive numbers in Naira', () => {
    expect(fmt(10)).toBe('₦10');
    expect(fmt(1234)).toBe('₦1,234');
  });

  it('formats zero', () => {
    expect(fmt(0)).toBe('₦0');
  });

  it('formats negative numbers', () => {
    expect(fmt(-50)).toBe('-₦50');
  });
});
