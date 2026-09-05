/**
 * Build cumulative equity-curve points from per-market settled PnL.
 * Does not invent series — empty input ⇒ empty output (UI shows honest empty).
 */
import type { EquityDataPoint } from '@/components/equity-curve';

export type EquityMarketPnL = {
  marketId: string;
  pnl: number;
};

export type EquityFillTimestamp = {
  market: string;
  timestamp?: string | number | null;
};

/**
 * Sort markets by earliest fill timestamp (fallback: stable index), then
 * accumulate realized/settled PnL into an equity series.
 */
export function buildEquityCurvePoints(
  marketPnL: EquityMarketPnL[],
  fills: EquityFillTimestamp[],
): EquityDataPoint[] {
  if (!marketPnL.length) return [];

  const earliestTsByMarket = new Map<string, number>();
  for (const f of fills) {
    const mid = (f.market ?? '').toLowerCase();
    if (!mid) continue;
    const ts = f.timestamp != null ? Number(f.timestamp) : NaN;
    if (!Number.isFinite(ts)) continue;
    const prev = earliestTsByMarket.get(mid);
    if (prev === undefined || ts < prev) earliestTsByMarket.set(mid, ts);
  }

  const sorted = [...marketPnL].sort((a, b) => {
    const aTs = earliestTsByMarket.get(a.marketId.toLowerCase());
    const bTs = earliestTsByMarket.get(b.marketId.toLowerCase());
    if (aTs != null && bTs != null && aTs !== bTs) return aTs - bTs;
    if (aTs != null && bTs == null) return -1;
    if (aTs == null && bTs != null) return 1;
    return a.marketId.localeCompare(b.marketId);
  });

  let running = 0;
  return sorted.map((m, idx) => {
    running += m.pnl;
    const ts = earliestTsByMarket.get(m.marketId.toLowerCase());
    return {
      timestamp: ts ?? idx,
      pnl: running,
    };
  });
}
