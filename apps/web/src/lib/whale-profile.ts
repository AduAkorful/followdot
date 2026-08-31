/**
 * Whale profile data — fetches detailed per-whale data: trade history,
 * open positions, skill-scored market breakdown, and PnL history for
 * equity-curve rendering.
 */
import {
  computeSkillScore,
  type MarketResult,
  type SkillScoreResult,
} from "@followdot/skill-score";
import {
  fetchTraderFills,
  fetchResolvedMarkets,
  buildMarketMap,
  computePerMarketPnL,
} from "./dreamdex";
import type { FillRow } from "@somnia-chain/markets-sdk";

export interface WhaleMarketPnL {
  marketId: string;
  marketAddress: string;
  marketType: string;
  pnl: number;
  isUp: boolean;
  tradeCount: number;
}

export interface MarketTypeWinRate {
  marketType: string;
  wins: number;
  total: number;
  winRate: number;
}

export interface WhaleProfileData {
  address: string;
  score: SkillScoreResult;
  marketPnL: WhaleMarketPnL[];
  fills: FillRow[];
  winRateByMarketType: MarketTypeWinRate[];
}

/** Fetch detailed profile data for a single whale address. */
export async function fetchWhaleProfile(
  address: string,
  signal?: AbortSignal,
): Promise<WhaleProfileData> {
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw new Error("Invalid wallet address format");
  }

  const normalizedAddr = address.toLowerCase();

  const markets = await fetchResolvedMarkets(signal);
  const marketMap = buildMarketMap(markets);
  const fills = await fetchTraderFills(normalizedAddr, 1000, signal);

  if (fills.length === 0) {
    const emptyScore = computeSkillScore({
      address: normalizedAddr,
      settledMarkets: [],
    });
    return {
      address: normalizedAddr,
      score: emptyScore,
      marketPnL: [],
      fills: [],
      winRateByMarketType: [],
    };
  }

  const marketPnL = await computePerMarketPnL(
    normalizedAddr,
    fills,
    marketMap,
    signal,
  );

  const marketResults: MarketResult[] = marketPnL.map((r) => ({
    marketId: r.marketId,
    marketType: r.marketType,
    pnl: r.pnl,
    isUp: r.isUp,
  }));

  const score = computeSkillScore({
    address: normalizedAddr,
    settledMarkets: marketResults,
  });

  // Build win-rate-by-market-type breakdown
  const buckets = new Map<string, { wins: number; total: number }>();
  for (const r of marketResults) {
    const existing = buckets.get(r.marketType) ?? { wins: 0, total: 0 };
    existing.total++;
    if (r.pnl >= 0) existing.wins++;
    buckets.set(r.marketType, existing);
  }
  const winRateByMarketType = [...buckets.entries()].map(([marketType, b]) => ({
    marketType,
    wins: b.wins,
    total: b.total,
    winRate: b.total > 0 ? b.wins / b.total : 0,
  }));

  return {
    address: normalizedAddr,
    score,
    marketPnL,
    fills,
    winRateByMarketType,
  };
}
