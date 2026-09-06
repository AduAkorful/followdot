import { describe, expect, it } from 'vitest';
import {
  buildEquityCurvePoints,
  countEquityCurveSettlements,
  selectSettledEquityMarkets,
} from './equity-curve-data';

describe('buildEquityCurvePoints', () => {
  it('returns empty for empty market PnL (no fake $0 series)', () => {
    expect(buildEquityCurvePoints([], [{ market: '0x1', timestamp: '10' }])).toEqual([]);
  });

  it('prepends $0 baseline before first settlement so one settlement draws a line', () => {
    const points = buildEquityCurvePoints(
      [{ marketId: '0xA', pnl: 12.5 }],
      [{ market: '0xA', timestamp: '100' }],
    );
    expect(points).toEqual([
      { timestamp: 99, pnl: 0 },
      { timestamp: 100, pnl: 12.5 },
    ]);
  });

  it('accumulates PnL ordered by earliest fill timestamp with baseline', () => {
    const points = buildEquityCurvePoints(
      [
        { marketId: '0xB', pnl: 20 },
        { marketId: '0xA', pnl: -5 },
      ],
      [
        { market: '0xA', timestamp: '100' },
        { market: '0xB', timestamp: '200' },
        { market: '0xA', timestamp: '50' },
      ],
    );
    expect(points).toEqual([
      { timestamp: 49, pnl: 0 },
      { timestamp: 50, pnl: -5 },
      { timestamp: 200, pnl: 15 },
    ]);
  });

  it('falls back to marketId order when timestamps missing, still with baseline', () => {
    const points = buildEquityCurvePoints(
      [
        { marketId: '0xB', pnl: 3 },
        { marketId: '0xA', pnl: 2 },
      ],
      [],
    );
    expect(points.map((p) => p.pnl)).toEqual([0, 2, 5]);
  });
});

describe('selectSettledEquityMarkets', () => {
  it('keeps settled / won markets and drops open unrealized', () => {
    expect(
      selectSettledEquityMarkets([
        { marketId: '0xopen', pnl: -5, settled: false },
        { marketId: '0xlost', pnl: -5, settled: true, won: false },
        { marketId: '0xwon', pnl: 1, settled: true, won: true },
        { marketId: '0xvoid', pnl: 0, settled: true },
      ]),
    ).toEqual([
      { marketId: '0xlost', pnl: -5 },
      { marketId: '0xwon', pnl: 1 },
      { marketId: '0xvoid', pnl: 0 },
    ]);
  });

  it('falls back to won flag when settled omitted (older payloads)', () => {
    expect(
      selectSettledEquityMarkets([
        { marketId: '0xopen', pnl: -1 },
        { marketId: '0xA', pnl: 2, won: true },
      ]),
    ).toEqual([{ marketId: '0xA', pnl: 2 }]);
  });
});

describe('countEquityCurveSettlements', () => {
  it('excludes the $0 baseline from settlement count', () => {
    const points = buildEquityCurvePoints(
      [{ marketId: '0xA', pnl: -5 }],
      [{ market: '0xA', timestamp: '100' }],
    );
    expect(points).toHaveLength(2);
    expect(countEquityCurveSettlements(points)).toBe(1);
  });

  it('returns 0 for empty series', () => {
    expect(countEquityCurveSettlements([])).toBe(0);
  });
});
