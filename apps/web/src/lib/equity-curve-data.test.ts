import { describe, expect, it } from 'vitest';
import { buildEquityCurvePoints } from './equity-curve-data';

describe('buildEquityCurvePoints', () => {
  it('returns empty for empty market PnL (no fake $0 series)', () => {
    expect(buildEquityCurvePoints([], [{ market: '0x1', timestamp: '10' }])).toEqual([]);
  });

  it('accumulates PnL ordered by earliest fill timestamp', () => {
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
      { timestamp: 50, pnl: -5 },
      { timestamp: 200, pnl: 15 },
    ]);
  });

  it('falls back to marketId order when timestamps missing', () => {
    const points = buildEquityCurvePoints(
      [
        { marketId: '0xB', pnl: 3 },
        { marketId: '0xA', pnl: 2 },
      ],
      [],
    );
    expect(points.map((p) => p.pnl)).toEqual([2, 5]);
  });
});
