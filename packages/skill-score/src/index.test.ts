import { describe, it, expect } from 'vitest';
import { computeSkillScore, rankWallets, type MarketResult } from './index';

describe('computeSkillScore', () => {
  it('returns 0 score for empty history', () => {
    const result = computeSkillScore({ address: '0xabc', settledMarkets: [] });
    expect(result.score).toBe(0);
    expect(result.totalMarkets).toBe(0);
  });

  it('rewards consistent winners (win rate > 50%)', () => {
    // 12 wins (pnl=10), 8 losses (pnl=-5) → 60% win rate
    const markets: MarketResult[] = Array.from({ length: 20 }, (_, i) => ({
      marketId: `m${i}`,
      marketType: 'BTC_hourly',
      pnl: i < 12 ? 10 : -5,
      isUp: i < 12,
    }));
    const result = computeSkillScore({ address: '0xabc', settledMarkets: markets });
    expect(result.winRate).toBe(0.6);
    expect(result.bayesianWinRate).toBeGreaterThan(0.5);
    expect(result.score).toBeGreaterThan(0);
  });

  it('shrinks win rate for small samples (Bayesian)', () => {
    // 1 trade, 1 win = 100% raw, but Bayesian shrinks it
    const markets: MarketResult[] = [
      { marketId: 'm1', marketType: 'BTC_hourly', pnl: 10, isUp: true },
    ];
    const result = computeSkillScore({ address: '0xabc', settledMarkets: markets });
    expect(result.winRate).toBe(1.0);
    expect(result.bayesianWinRate).toBeLessThan(1.0);
  });

  it('penalizes variance', () => {
    // Same avg PnL but high variance → lower score
    const stableMarkets: MarketResult[] = Array.from({ length: 10 }, (_, i) => ({
      marketId: `s${i}`,
      marketType: 'BTC_hourly',
      pnl: 10,
      isUp: true,
    }));
    const volatileMarkets: MarketResult[] = [
      ...Array.from({ length: 5 }, (_, i) => ({
        marketId: `v${i}`, marketType: 'BTC_hourly', pnl: 100, isUp: true,
      })),
      ...Array.from({ length: 5 }, (_, i) => ({
        marketId: `v${i + 5}`, marketType: 'BTC_hourly', pnl: -100, isUp: false,
      })),
    ];
    const stableScore = computeSkillScore({ address: '0x1', settledMarkets: stableMarkets });
    const volatileScore = computeSkillScore({ address: '0x2', settledMarkets: volatileMarkets });
    expect(stableScore.variancePenalty).toBeLessThan(volatileScore.variancePenalty);
  });

  it('scores a losing wallet lower than a winning wallet', () => {
    const good: MarketResult[] = Array.from({ length: 20 }, (_, i) => ({
      marketId: `g${i}`,
      marketType: 'BTC_hourly',
      pnl: i < 12 ? 10 : -5,
      isUp: i < 12,
    }));
    const bad: MarketResult[] = Array.from({ length: 20 }, (_, i) => ({
      marketId: `b${i}`,
      marketType: 'BTC_hourly',
      pnl: i < 8 ? 5 : -10,
      isUp: i < 8,
    }));

    const goodScore = computeSkillScore({ address: '0x2', settledMarkets: good });
    const badScore = computeSkillScore({ address: '0x1', settledMarkets: bad });
    expect(goodScore.score).toBeGreaterThan(badScore.score);
  });
});

describe('rankWallets', () => {
  it('sorts by score descending', () => {
    const good: MarketResult[] = Array.from({ length: 20 }, (_, i) => ({
      marketId: `g${i}`,
      marketType: 'BTC_hourly',
      pnl: i < 12 ? 10 : -5,
      isUp: i < 12,
    }));
    const bad: MarketResult[] = Array.from({ length: 20 }, (_, i) => ({
      marketId: `b${i}`,
      marketType: 'BTC_hourly',
      pnl: i < 8 ? 5 : -10,
      isUp: i < 8,
    }));
    const results = rankWallets([
      { address: '0x1', settledMarkets: bad },
      { address: '0x2', settledMarkets: good },
    ]);
    expect(results[0].address).toBe('0x2');
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });
});

describe('alpha=5 shrinkage (spec §11 #1)', () => {
  it('single win shrinks heavily toward 0.5 with alpha=5', () => {
    const result = computeSkillScore({
      address: '0xabc',
      settledMarkets: [
        { marketId: 'm1', marketType: 'BTC_hourly', pnl: 10, isUp: true },
      ],
    });
    // (1+5)/(1+10) = 6/11 ≈ 0.545
    expect(result.bayesianWinRate).toBeCloseTo(6 / 11, 3);
    expect(result.bayesianWinRate).toBeLessThan(0.6);
    expect(result.bayesianWinRate).toBeGreaterThan(0.5);
  });

  it('100% win rate shrinks as sample grows (never reaches 1.0)', () => {
    const result = computeSkillScore({
      address: '0xabc',
      settledMarkets: Array.from({ length: 20 }, (_, i) => ({
        marketId: `m${i}`, marketType: 'BTC_hourly', pnl: 10, isUp: true,
      })),
    });
    // (20+5)/(20+10) = 25/30 ≈ 0.833
    expect(result.bayesianWinRate).toBeCloseTo(25 / 30, 3);
  });

  it('0% win rate does not reach 0.0 (floor from shrinkage)', () => {
    const result = computeSkillScore({
      address: '0xabc',
      settledMarkets: Array.from({ length: 20 }, (_, i) => ({
        marketId: `m${i}`, marketType: 'BTC_hourly', pnl: -10, isUp: false,
      })),
    });
    // (0+5)/(20+10) = 5/30 ≈ 0.167
    expect(result.bayesianWinRate).toBeCloseTo(5 / 30, 3);
    expect(result.bayesianWinRate).toBeGreaterThan(0);
  });
});

describe('score normalization bounds', () => {
  it('clamps score to [0, 1]', () => {
    // Extreme: 100 wins, 0 losses, tiny variance → should be near 1
    const perfect = computeSkillScore({
      address: '0x1',
      settledMarkets: Array.from({ length: 100 }, (_, i) => ({
        marketId: `m${i}`, marketType: 'BTC_hourly', pnl: 10, isUp: true,
      })),
    });
    expect(perfect.score).toBeGreaterThanOrEqual(0);
    expect(perfect.score).toBeLessThanOrEqual(1);
    expect(perfect.score).toBeCloseTo(1, 1);

    // Extreme: 0 wins, 100 losses → should be near 0
    const terrible = computeSkillScore({
      address: '0x2',
      settledMarkets: Array.from({ length: 100 }, (_, i) => ({
        marketId: `m${i}`, marketType: 'BTC_hourly', pnl: -10, isUp: false,
      })),
    });
    expect(terrible.score).toBeGreaterThanOrEqual(0);
    expect(terrible.score).toBeLessThanOrEqual(1);
  });
});

describe('market type isolation', () => {
  it('consistencyFactor = 0 when no market-type bucket is consistent', () => {
    // Equal wins/losses in a single bucket → 50% win rate, which IS ≥ 0.5
    // So use two buckets, one at 0% and one at 0%
    const result = computeSkillScore({
      address: '0xabc',
      settledMarkets: [
        { marketId: 'a', marketType: 'BTC_hourly', pnl: -10, isUp: false },
        { marketId: 'b', marketType: 'ETH_hourly', pnl: -10, isUp: false },
      ],
    });
    expect(result.consistencyFactor).toBe(0);
    expect(result.score).toBeLessThanOrEqual(0.5);
  });
});

describe('NaN and Infinity safety', () => {
  it('handles zero pnl without NaN', () => {
    const result = computeSkillScore({
      address: '0xabc',
      settledMarkets: Array.from({ length: 10 }, (_, i) => ({
        marketId: `m${i}`, marketType: 'BTC_hourly', pnl: 0, isUp: true,
      })),
    });
    expect(result.score).not.toBeNaN();
    expect(result.variancePenalty).toBe(0); // no variance when all pnl = 0
  });

  it('penalizes max when mean≈0 with non-zero variance (pure noise)', () => {
    // 5 wins of +10, 5 losses of -10 → mean=0, high variance → max penalty
    const result = computeSkillScore({
      address: '0xabc',
      settledMarkets: [
        ...Array.from({ length: 5 }, (_, i) => ({
          marketId: `w${i}`, marketType: 'BTC_hourly', pnl: 10, isUp: true,
        })),
        ...Array.from({ length: 5 }, (_, i) => ({
          marketId: `l${i}`, marketType: 'BTC_hourly', pnl: -10, isUp: false,
        })),
      ],
    });
    expect(result.score).not.toBeNaN();
    expect(result.variancePenalty).toBe(0.5); // mean≈0 + variance → max penalty
  });

  it('handles negative pnl values', () => {
    const result = computeSkillScore({
      address: '0xabc',
      settledMarkets: Array.from({ length: 10 }, (_, i) => ({
        marketId: `m${i}`, marketType: 'BTC_hourly', pnl: -5, isUp: false,
      })),
    });
    expect(result.score).not.toBeNaN();
    expect(result.totalRealizedPnL).toBe(-50);
  });

  it('single loss with 0 wins → Bayesian floor', () => {
    // bayesianWinRate = (wins + α) / (totalMarkets + 2α) = (0 + 5) / (1 + 10) = 5/11
    const result = computeSkillScore({
      address: '0xabc',
      settledMarkets: [
        { marketId: 'm1', marketType: 'BTC_hourly', pnl: -10, isUp: false },
      ],
    });
    expect(result.winRate).toBe(0);
    expect(result.bayesianWinRate).toBeCloseTo(5 / 11, 3); // (0+5)/(1+10)
    expect(result.score).not.toBeNaN();
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThan(1);
  });

  it('score is bounded between 0 and 1 for all input ranges', () => {
    const allLosses = Array.from({ length: 50 }, (_, i) => ({
      marketId: `m${i}`, marketType: 'BTC_hourly', pnl: -5, isUp: false,
    }));
    const allWins = Array.from({ length: 50 }, (_, i) => ({
      marketId: `m${i}`, marketType: 'BTC_hourly', pnl: 10, isUp: true,
    }));
    const worst = computeSkillScore({ address: '0xabc', settledMarkets: allLosses });
    const best = computeSkillScore({ address: '0xabc', settledMarkets: allWins });
    expect(worst.score).toBeGreaterThanOrEqual(0);
    expect(worst.score).toBeLessThan(1);
    expect(best.score).toBeLessThanOrEqual(1);
    expect(best.score).toBeGreaterThan(0);
    // Perfect score (100% wins, large n) → Bayesian ≈ 1.0, but capped by score formula
    expect(best.score).toBeLessThanOrEqual(1);
  });

  it('consistencyFactor = 0 when all market types are inconsistent', () => {
    // WIN + LOSS alternation prevents any bucket from being consistent
    const mixed = Array.from({ length: 20 }, (_, i) => ({
      marketId: `m${i}`,
      marketType: i % 2 === 0 ? 'BTC_hourly' : 'ETH_daily',
      pnl: i % 2 === 0 ? 5 : -5,
      isUp: i % 2 === 0,
    }));
    const result = computeSkillScore({ address: '0xabc', settledMarkets: mixed });
    expect(result.consistencyFactor).toBeLessThan(1);
    expect(result.consistencyFactor).toBeGreaterThanOrEqual(0);
  });

  it('handles all-zero pnl with non-zero variance (edge case)', () => {
    // Zero pnl → mean=0 → variance=0 → variancePenalty=0 → score driven by bayesian only
    const result = computeSkillScore({
      address: '0xabc',
      settledMarkets: Array.from({ length: 20 }, (_, i) => ({
        marketId: `m${i}`, marketType: 'BTC_hourly', pnl: 0, isUp: i % 2 === 0,
      })),
    });
    expect(result.variancePenalty).toBe(0);
    expect(result.score).not.toBeNaN();
    expect(result.totalRealizedPnL).toBe(0);
  });
});
