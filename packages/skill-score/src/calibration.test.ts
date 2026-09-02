import { describe, it, expect } from 'vitest';
import {
  buildCalibrationBuckets,
  computeCalibrationScore,
  computeCalibration,
  type CalibrationFill,
  type CalibrationBucket,
} from './calibration';

/**
 * Generate a fill with implied probability `price` and outcome `won`.
 * Shorthand for test readability.
 */
function fill(price: number, won: boolean, marketType?: string): CalibrationFill {
  return { fillPrice: price, won, marketType };
}

describe('buildCalibrationBuckets', () => {
  it('lands boundary probabilities in the correct bucket', () => {
    // 0.50 → 50-55 bucket, 0.55 → 55-60 bucket
    const fills = [
      fill(0.50, true),
      fill(0.55, true),
      fill(0.60, true),
    ];
    const buckets = buildCalibrationBuckets(fills) as CalibrationBucket[];

    expect(buckets).toHaveLength(3);
    expect(buckets[0].lowerBound).toBeCloseTo(0.50);
    expect(buckets[0].upperBound).toBeCloseTo(0.55);
    expect(buckets[1].lowerBound).toBeCloseTo(0.55);
    expect(buckets[1].upperBound).toBeCloseTo(0.60);
    expect(buckets[2].lowerBound).toBeCloseTo(0.60);
    expect(buckets[2].upperBound).toBeCloseTo(0.65);
  });

  it('excludes fills below min probability', () => {
    const fills = [fill(0.30, true), fill(0.50, true)];
    const buckets = buildCalibrationBuckets(fills) as CalibrationBucket[];
    expect(buckets).toHaveLength(1);
    expect(buckets[0].total).toBe(1);
  });

  it('excludes fills at or above max probability', () => {
    const fills = [fill(0.95, true), fill(0.50, true)];
    const buckets = buildCalibrationBuckets(fills) as CalibrationBucket[];
    expect(buckets).toHaveLength(1);
    expect(buckets[0].total).toBe(1);
  });

  it('drops empty buckets from result', () => {
    const fills = [fill(0.70, true), fill(0.72, false)];
    const buckets = buildCalibrationBuckets(fills) as CalibrationBucket[];
    expect(buckets).toHaveLength(1);
    expect(buckets[0].lowerBound).toBeCloseTo(0.70);
  });

  it('supports per-market-type bucketing', () => {
    const fills = [
      fill(0.70, true, 'BTC_hourly'),
      fill(0.72, false, 'BTC_hourly'),
      fill(0.60, true, 'ETH_daily'),
      fill(0.62, true, 'ETH_daily'),
    ];
    const result = buildCalibrationBuckets(fills, { byMarketType: true });
    expect(result).toBeInstanceOf(Map);

    const map = result as Map<string, CalibrationBucket[]>;
    expect(map.has('BTC_hourly')).toBe(true);
    expect(map.has('ETH_daily')).toBe(true);

    const btc = map.get('BTC_hourly')!;
    expect(btc).toHaveLength(1);
    expect(btc[0].lowerBound).toBe(0.70);
    expect(btc[0].actualWinRate).toBe(0.5); // 1 win / 2 total

    const eth = map.get('ETH_daily')!;
    expect(eth).toHaveLength(1);
    expect(eth[0].lowerBound).toBe(0.60);
    expect(eth[0].actualWinRate).toBe(1.0); // 2 wins / 2 total
  });
});

describe('computeCalibrationScore', () => {
  it('perfectly calibrated buckets → score 1.0', () => {
    // Actual win rate equals midpoint for each bucket
    const buckets: CalibrationBucket[] = [
      { lowerBound: 0.50, upperBound: 0.55, midpoint: 0.525, wins: 5, total: 10, actualWinRate: 0.525 },
      { lowerBound: 0.70, upperBound: 0.75, midpoint: 0.725, wins: 7, total: 10, actualWinRate: 0.725 },
      { lowerBound: 0.90, upperBound: 0.95, midpoint: 0.925, wins: 8, total: 10, actualWinRate: 0.925 },
    ];
    expect(computeCalibrationScore(buckets)).toBeCloseTo(1.0, 6);
  });

  it('perfectly miscalibrated → score ~0.0', () => {
    // Implied 70% but won 0% → deviation = 0.725
    // Implied 90% but won 0% → deviation = 0.925
    // Implied 50% but won 0% → deviation = 0.525
    const buckets: CalibrationBucket[] = [
      { lowerBound: 0.50, upperBound: 0.55, midpoint: 0.525, wins: 0, total: 10, actualWinRate: 0 },
      { lowerBound: 0.70, upperBound: 0.75, midpoint: 0.725, wins: 0, total: 10, actualWinRate: 0 },
      { lowerBound: 0.90, upperBound: 0.95, midpoint: 0.925, wins: 0, total: 10, actualWinRate: 0 },
    ];
    // mean deviation = (0.525 + 0.725 + 0.925) / 3 = 0.725
    // score = 1 - 0.725 = 0.275, clamped to [0,1]
    expect(computeCalibrationScore(buckets)).toBeCloseTo(0.275, 3);
  });

  it('partial calibration → intermediate score', () => {
    // One bucket perfect, one off by 0.2
    const buckets: CalibrationBucket[] = [
      { lowerBound: 0.50, upperBound: 0.55, midpoint: 0.525, wins: 5, total: 10, actualWinRate: 0.525 },
      { lowerBound: 0.70, upperBound: 0.75, midpoint: 0.725, wins: 5, total: 10, actualWinRate: 0.525 },
      // deviation = |0.525 - 0.725| = 0.2
    ];
    // mean deviation = (0 + 0.2) / 2 = 0.1
    // score = 1 - 0.1 = 0.9
    expect(computeCalibrationScore(buckets)).toBeCloseTo(0.9, 3);
  });

  it('empty buckets → score 0', () => {
    expect(computeCalibrationScore([])).toBe(0);
  });
});

describe('computeCalibration (integration)', () => {
  it('perfectly calibrated fills → score 1.0', () => {
    // In each bucket, actual win rate equals the bucket midpoint
    const fills: CalibrationFill[] = [];
    // 50-55% bucket (mid=0.525): 52.5% win rate ≈ 21 wins of 40
    for (let i = 0; i < 21; i++) fills.push(fill(0.51, true));
    for (let i = 0; i < 19; i++) fills.push(fill(0.51, false));

    // 70-75% bucket (mid=0.725): 72.5% win rate ≈ 145 wins of 200
    for (let i = 0; i < 145; i++) fills.push(fill(0.71, true));
    for (let i = 0; i < 55; i++) fills.push(fill(0.71, false));

    const result = computeCalibration(fills);
    // The win rates won't be exact, but should be close to midpoint
    expect(result.score).toBeGreaterThan(0.9);
  });

  it('miscalibrated fills → score < 0.5', () => {
    // Whale buys at ~0.75 implied but wins only 20%
    const fills: CalibrationFill[] = [];
    for (let i = 0; i < 20; i++) fills.push(fill(0.72, true));
    for (let i = 0; i < 80; i++) fills.push(fill(0.72, false));
    const result = computeCalibration(fills);
    expect(result.score).toBeLessThan(0.5);
  });

  it('returns 0 score for fills with no data in range', () => {
    // All fills below 0.50 — excluded from buckets
    const fills = [fill(0.30, true), fill(0.40, false)];
    const result = computeCalibration(fills);
    expect(result.score).toBe(0);
    expect(result.buckets).toHaveLength(0);
  });

  it('handles per-market-type bucketing via computeCalibration', () => {
    const fills: CalibrationFill[] = [
      fill(0.70, true, 'BTC_hourly'),
      fill(0.72, true, 'BTC_hourly'),
      fill(0.60, true, 'ETH_daily'),
      fill(0.62, true, 'ETH_daily'),
    ];
    const result = computeCalibration(fills, { byMarketType: true });
    expect(result.buckets.length).toBeGreaterThan(0);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });
});
