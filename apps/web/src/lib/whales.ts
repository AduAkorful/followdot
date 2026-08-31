/**
 * Whale leaderboard — discovers top traders from the real DreamDEX indexer,
 * computes per-market PnL, and scores each wallet using the real
 * @followdot/skill-score package.
 */
import { computeSkillScore, type MarketResult, type SkillScoreResult } from "@followdot/skill-score";
import {
  fetchRecentFills,
  extractTopTraders,
  fetchTraderFills,
  fetchResolvedMarkets,
  buildMarketMap,
  computePerMarketPnL,
} from "./dreamdex";

export { extractTopTraders };

export interface WhaleLeaderboardEntry {
  address: string;
  score: number;
  winRate: number;
  bayesianWinRate: number;
  consistencyFactor: number;
  variancePenalty: number;
  totalMarkets: number;
  totalRealizedPnL: number;
  lastUpdated: number;
}

/**
 * Fetch the whale leaderboard from the real DreamDEX indexer.
 *
 * Pipeline:
 *   1. Fetch resolved binary markets (resolution + metadata)
 *   2. Fetch recent fills to discover top trader addresses
 *   3. For each trader: fetch their fills, compute per-market PnL
 *   4. Score each wallet with the real skill-score formula
 *   5. Sort by score descending
 *
 * No mock data. If the indexer returns no fills or no resolved markets,
 * the result is an empty array — never placeholder data.
 *
 * Errors for individual whales are logged but don't abort the pipeline.
 */
export async function fetchWhaleLeaderboard(
  limit = 20,
  signal?: AbortSignal,
): Promise<WhaleLeaderboardEntry[]> {
  // Step 1 — resolved markets (has winningOutcome set)
  const markets = await fetchResolvedMarkets(signal);
  const marketMap = buildMarketMap(markets);

  // Step 2 — discover top traders from recent activity
  const fills = await fetchRecentFills(500, signal);
  const traderAddresses = extractTopTraders(fills, limit);

  if (traderAddresses.length === 0) return [];

  // Step 3 + 4 — for each trader, fetch fills and compute skill score
  const entries: WhaleLeaderboardEntry[] = [];

  for (const address of traderAddresses) {
    if (signal?.aborted) break;
    try {
      const traderFills = await fetchTraderFills(address, 1000, signal);
      if (traderFills.length === 0) continue;

      const marketPnL = await computePerMarketPnL(address, traderFills, marketMap, signal);
      if (marketPnL.length === 0) continue;

      const marketResults: MarketResult[] = marketPnL.map((r) => ({
        marketId: r.marketId,
        marketType: r.marketType,
        pnl: r.pnl,
        isUp: r.isUp,
      }));

      const score: SkillScoreResult = computeSkillScore({
        address,
        settledMarkets: marketResults,
      });

      entries.push({
        address: score.address,
        score: score.score,
        winRate: score.winRate,
        bayesianWinRate: score.bayesianWinRate,
        consistencyFactor: score.consistencyFactor,
        variancePenalty: score.variancePenalty,
        totalMarkets: score.totalMarkets,
        totalRealizedPnL: score.totalRealizedPnL,
        lastUpdated: score.lastUpdated,
      });
    } catch (err) {
      // Log the error so silent truncation is diagnosable, but don't
      // abort the pipeline — skip this whale and continue.
      console.error(
        `[whales] Failed to score trader ${address}:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  return entries.sort((a, b) => b.score - a.score);
}
