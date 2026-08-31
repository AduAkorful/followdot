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
});
