import { describe, it, expect } from 'vitest';
import {
  formatFillPrice,
  formatFillQuantity,
  resolveFillQuoteDecimals,
  scaleQuoteAmount,
  formatClaimAmount,
  scaleClaimAmount,
} from './format-fill';

describe('scaleQuoteAmount', () => {
  it('scales raw fill ints by quoteDecimals', () => {
    expect(scaleQuoteAmount('400000', 6)).toBeCloseTo(0.4, 8);
    expect(scaleQuoteAmount('100000000', 6)).toBeCloseTo(100, 8);
  });

  it('returns null for missing decimals or raw values', () => {
    expect(scaleQuoteAmount('400000', undefined)).toBeNull();
    expect(scaleQuoteAmount('', 6)).toBeNull();
    expect(scaleQuoteAmount('400000', 1.5)).toBeNull();
  });
});

describe('formatFillPrice / formatFillQuantity', () => {
  it('never renders raw ints as dollars', () => {
    expect(formatFillPrice('400000', 6)).toBe('$0.4000');
    expect(formatFillQuantity('100000000', 6)).toBe('100.00');
    expect(formatFillPrice('400000', undefined)).toBe('—');
    expect(formatFillQuantity(undefined, 6)).toBe('—');
  });
});

describe('resolveFillQuoteDecimals', () => {
  it('prefers extra map then marketPnL', () => {
    const marketPnL = [{ marketId: '0xABC', quoteDecimals: 6 }];
    expect(resolveFillQuoteDecimals('0xabc', marketPnL)).toBe(6);
    expect(resolveFillQuoteDecimals('0xabc', marketPnL, { '0xabc': 8 })).toBe(8);
    expect(resolveFillQuoteDecimals('0xdef', marketPnL)).toBeUndefined();
  });
});

describe('formatClaimAmount / scaleClaimAmount', () => {
  it('scales claimable raw ints by provided decimals', () => {
    expect(scaleClaimAmount(1_000_000n, 6)).toBeCloseTo(1, 8);
    expect(scaleClaimAmount(1_000_000_000_000_000_000n, 18)).toBeCloseTo(1, 8);
    expect(formatClaimAmount(1_500_000n, 6)).toBe('$1.50');
  });

  it('never assumes decimals when missing', () => {
    expect(scaleClaimAmount(1_000_000n, undefined)).toBeNull();
    expect(formatClaimAmount(1_000_000n, null)).toBe('—');
  });
});
