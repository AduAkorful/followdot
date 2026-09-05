import { describe, it, expect } from 'vitest';
import {
  formatSignedUsd,
  formatSnapshotLabel,
  resolveConsistencyDisplay,
  resolveRankDisplay,
  sumNetRealizedPnL,
} from '@/lib/whale-display';

describe('resolveRankDisplay', () => {
  it('does not invent Top 25% from missing rank params', () => {
    expect(resolveRankDisplay(null, null)).toEqual({
      status: 'unranked',
      rank: null,
      total: null,
      percentile: null,
      percentileLabel: null,
      whaleLabel: 'Unranked',
    });
  });

  it('stays Unranked when only total is present', () => {
    expect(resolveRankDisplay(null, 40).whaleLabel).toBe('Unranked');
    expect(resolveRankDisplay(null, 40).percentileLabel).toBeNull();
  });

  it('stays Unranked when only rank is present', () => {
    expect(resolveRankDisplay(1, null).whaleLabel).toBe('Unranked');
    expect(resolveRankDisplay(1, null).percentileLabel).toBeNull();
  });

  it('rejects non-positive or non-integer rank params', () => {
    expect(resolveRankDisplay(0, 10).status).toBe('unranked');
    expect(resolveRankDisplay(-1, 10).status).toBe('unranked');
    expect(resolveRankDisplay(1.5, 10).status).toBe('unranked');
    expect(resolveRankDisplay(3, 0).status).toBe('unranked');
  });

  it('labels live top ranks without falling through to Top 25%', () => {
    expect(resolveRankDisplay(1, 100).percentileLabel).toBe('Top 5%');
    expect(resolveRankDisplay(8, 100).percentileLabel).toBe('Top 10%');
    expect(resolveRankDisplay(20, 100).percentileLabel).toBe('Top 25%');
  });

  it('omits percentile badge for mid/low live ranks instead of inventing Top 25%', () => {
    const mid = resolveRankDisplay(40, 50);
    expect(mid.status).toBe('ranked');
    expect(mid.whaleLabel).toBe('Ranked Whale');
    expect(mid.percentileLabel).toBeNull();
    expect(mid.rank).toBe(40);
    expect(mid.total).toBe(50);
  });
});

describe('resolveConsistencyDisplay', () => {
  it('is Consistent/up only when types are stable and variance is low', () => {
    const chip = resolveConsistencyDisplay(0.85, 0.05);
    expect(chip.label).toBe('Consistent');
    expect(chip.trend).toBe('up');
  });

  it('does not always say Consistent/up', () => {
    expect(resolveConsistencyDisplay(0.2, 0.1).label).toBe('Inconsistent');
    expect(resolveConsistencyDisplay(0.2, 0.1).trend).toBe('down');
    expect(resolveConsistencyDisplay(0.8, 0.4).label).toBe('Uneven');
    expect(resolveConsistencyDisplay(0.8, 0.4).trend).toBe('down');
    expect(resolveConsistencyDisplay(0.1, 0.4).label).toBe('Volatile');
    expect(resolveConsistencyDisplay(0.55, 0.1).label).toBe('Mixed');
    expect(resolveConsistencyDisplay(0.55, 0.1).trend).toBe('neutral');
  });

  it('treats non-finite inputs as zero rather than inventing consistency', () => {
    const chip = resolveConsistencyDisplay(Number.NaN, Number.POSITIVE_INFINITY);
    expect(chip.label).toBe('Inconsistent');
    expect(chip.trend).toBe('down');
  });
});

describe('sumNetRealizedPnL / formatSignedUsd', () => {
  it('nets losses against gains instead of abs-summing', () => {
    expect(sumNetRealizedPnL([100, -40, 10])).toBe(70);
    expect(sumNetRealizedPnL([100, -40, 10])).not.toBe(150);
    expect(sumNetRealizedPnL([-80, -20])).toBe(-100);
  });

  it('formats compact signed USD', () => {
    expect(formatSignedUsd(1500)).toBe('$1.5K');
    expect(formatSignedUsd(-1500)).toBe('-$1.5K');
    expect(formatSignedUsd(-2_400_000)).toBe('-$2.4M');
    expect(formatSignedUsd(40)).toBe('$40');
  });
});

describe('formatSnapshotLabel', () => {
  it('returns null for missing or invalid timestamps', () => {
    expect(formatSnapshotLabel(null)).toBeNull();
    expect(formatSnapshotLabel(undefined)).toBeNull();
    expect(formatSnapshotLabel('not-a-date')).toBeNull();
  });

  it('formats a valid ISO timestamp', () => {
    const label = formatSnapshotLabel('2026-09-05T21:00:00.000Z');
    expect(label).toBeTruthy();
    expect(label).not.toMatch(/Invalid/i);
  });
});
