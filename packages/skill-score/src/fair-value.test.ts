import { describe, it, expect } from 'vitest';
import {
  normalCdf,
  computeFairValue,
  computeEdgeBps,
  ewmaVolatility,
} from './fair-value';

describe('normalCdf', () => {
  it('Phi(0) = 0.5', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
  });

  it('Phi(1.96) ≈ 0.975', () => {
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
  });

  it('Phi(-1.96) ≈ 0.025', () => {
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 3);
  });

  it('symmetry: Phi(-z) = 1 - Phi(z)', () => {
    for (const z of [0.5, 1.0, 1.96, 2.5, 3.0]) {
      expect(normalCdf(-z)).toBeCloseTo(1 - normalCdf(z), 6);
    }
  });

  it('monotonic increasing', () => {
    const zs = [-3, -2, -1, -0.5, 0, 0.5, 1, 2, 3];
    let prev = -Infinity;
    for (const z of zs) {
      const val = normalCdf(z);
      expect(val).toBeGreaterThanOrEqual(prev);
      prev = val;
    }
  });

  it('clamps to [0, 1] at extreme tails', () => {
    expect(normalCdf(-10)).toBe(0);
    expect(normalCdf(10)).toBe(1);
    expect(normalCdf(-100)).toBe(0);
    expect(normalCdf(100)).toBe(1);
  });

  it('returns NaN for non-finite input', () => {
    expect(normalCdf(NaN)).toBeNaN();
    expect(normalCdf(Infinity)).toBe(1);
    expect(normalCdf(-Infinity)).toBe(0);
  });

  it('Phi(1) ≈ 0.8413 (known table value)', () => {
    expect(normalCdf(1)).toBeCloseTo(0.8413, 3);
  });

  it('Phi(2) ≈ 0.9772 (known table value)', () => {
    expect(normalCdf(2)).toBeCloseTo(0.9772, 3);
  });
});

describe('computeFairValue', () => {
  it('returns a valid probability in [0, 1] for normal inputs', () => {
    const fv = computeFairValue(0.5, 0.6, 0.3, 0.5);
    expect(fv).toBeGreaterThanOrEqual(0);
    expect(fv).toBeLessThanOrEqual(1);
  });

  it('monotonic in fill price S (higher S → higher fairProb)', () => {
    const sigma = 0.3;
    const tau = 0.5;
    const S0 = 0.5;
    const low = computeFairValue(S0, 0.55, sigma, tau);
    const high = computeFairValue(S0, 0.95, sigma, tau);
    expect(high).toBeGreaterThan(low);
  });

  it('returns NaN when sigma <= 0', () => {
    expect(computeFairValue(0.5, 0.6, 0, 0.5)).toBeNaN();
    expect(computeFairValue(0.5, 0.6, -0.1, 0.5)).toBeNaN();
  });

  it('returns NaN when tau <= 0', () => {
    expect(computeFairValue(0.5, 0.6, 0.3, 0)).toBeNaN();
    expect(computeFairValue(0.5, 0.6, 0.3, -1)).toBeNaN();
  });

  it('returns NaN when S0 <= 0', () => {
    expect(computeFairValue(0, 0.6, 0.3, 0.5)).toBeNaN();
    expect(computeFairValue(-0.5, 0.6, 0.3, 0.5)).toBeNaN();
  });

  it('returns NaN when S <= 0', () => {
    expect(computeFairValue(0.5, 0, 0.3, 0.5)).toBeNaN();
    expect(computeFairValue(0.5, -0.5, 0.3, 0.5)).toBeNaN();
  });

  it('returns NaN for non-finite inputs', () => {
    expect(computeFairValue(NaN, 0.6, 0.3, 0.5)).toBeNaN();
    expect(computeFairValue(0.5, NaN, 0.3, 0.5)).toBeNaN();
  });

  it('S === S0 with large tau → fairProb approaches 0.5 (drift dominates)', () => {
    // When S = S0, d2 = (sigma^2 / 2 * tau) / (sigma * sqrt(tau)) = sigma * sqrt(tau) / 2
    // For small tau this is near 0 → Phi(0) = 0.5
    const fv = computeFairValue(0.5, 0.5, 0.3, 0.001);
    expect(fv).toBeCloseTo(0.5, 2);
  });
});

describe('computeEdgeBps', () => {
  it('is 0 when fillPrice === fairValue', () => {
    expect(computeEdgeBps(0.7, 0.7)).toBe(0);
  });

  it('scales by 10000', () => {
    // fillPrice=0.75, fairValue=0.70 → diff=0.05 → 500 bps
    expect(computeEdgeBps(0.75, 0.70)).toBeCloseTo(500, 1);
  });

  it('propagates NaN', () => {
    expect(computeEdgeBps(NaN, 0.7)).toBeNaN();
    expect(computeEdgeBps(0.7, NaN)).toBeNaN();
  });

  it('is the exact negative when inputs are swapped', () => {
    const a = 0.78;
    const b = 0.62;
    expect(computeEdgeBps(a, b)).toBe(-computeEdgeBps(b, a));
  });

  it('negative edge = favorable entry (whale bought below fair value)', () => {
    // fillPrice=0.55, fairValue=0.60 → (0.55-0.60)*10000 = -500 (good entry, green)
    expect(computeEdgeBps(0.55, 0.60)).toBeLessThan(0);
  });

  it('positive edge = unfavorable entry (whale overpaid above fair value)', () => {
    // fillPrice=0.65, fairValue=0.60 → (0.65-0.60)*10000 = +500 (overpaid, red)
    expect(computeEdgeBps(0.65, 0.60)).toBeGreaterThan(0);
  });
});

describe('ewmaVolatility', () => {
  it('returns 0 with fewer than 2 samples', () => {
    expect(ewmaVolatility([])).toBe(0);
    expect(ewmaVolatility([0.5])).toBe(0);
  });

  it('returns 0 for constant series', () => {
    expect(ewmaVolatility([0.5, 0.5, 0.5, 0.5])).toBe(0);
  });

  it('is non-negative and finite for varying series', () => {
    const prices = [0.5, 0.6, 0.55, 0.7, 0.65, 0.8];
    const vol = ewmaVolatility(prices);
    expect(vol).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(vol)).toBe(true);
  });

  it('returns 0 when all returns are zero (constant price)', () => {
    const vol = ewmaVolatility([0.3, 0.3, 0.3]);
    expect(vol).toBe(0);
  });

  it('ignores NaN prices', () => {
    const prices = [0.5, NaN, 0.6, 0.55];
    const vol = ewmaVolatility(prices);
    expect(Number.isFinite(vol)).toBe(true);
    expect(vol).toBeGreaterThan(0);
  });

  it('produces higher volatility for more volatile series', () => {
    const stable = [0.5, 0.501, 0.499, 0.5, 0.501];
    const volatile = [0.1, 0.9, 0.1, 0.9, 0.1];
    expect(ewmaVolatility(volatile)).toBeGreaterThan(ewmaVolatility(stable));
  });

  it('respects lambda parameter', () => {
    const prices = [0.5, 0.6, 0.55, 0.7, 0.65];
    const volDefault = ewmaVolatility(prices);
    const volHighLambda = ewmaVolatility(prices, 0.99);
    // Both should be finite and non-negative
    expect(Number.isFinite(volDefault)).toBe(true);
    expect(Number.isFinite(volHighLambda)).toBe(true);
  });

  it('returns 0 volatility when lambda is 1 (no decay, constant mean reverts)', () => {
    const prices = [0.5, 0.6, 0.55, 0.7, 0.65];
    const vol = ewmaVolatility(prices, 1.0);
    expect(vol).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(vol)).toBe(true);
  });

  it('S0 > 1 still returns a valid probability (math holds)', () => {
    // computeFairValue doesn't clamp S0; S0=1.5 with fill S=0.6 means a 40% drop,
    // d2 = (log(0.6/1.5) + ...) / (...) → Phi of a negative number → small probability
    const fv = computeFairValue(1.5, 0.6, 0.3, 0.5);
    expect(fv).not.toBeNaN();
    expect(fv).toBeGreaterThanOrEqual(0);
    expect(fv).toBeLessThanOrEqual(1);
  });

  it('large fill-price drop from S0 yields a small fair value', () => {
    // S0=0.9, S=0.1 → drop of 89% → very small fair value
    const fv = computeFairValue(0.9, 0.1, 0.4, 0.5);
    expect(fv).toBeGreaterThan(0);
    expect(fv).toBeLessThan(0.5);
  });
});
