/**
 * Whale leaderboard — discovers top traders from the real DreamDEX indexer,
 * computes per-market PnL, and scores each wallet using the real
 * @followdot/skill-score package.
 */
import {
  computeSkillScore,
  buildCalibrationBuckets,
  computeCalibrationScore,
  type MarketResult,
  type SkillScoreResult,
} from "@followdot/skill-score";
import {
  fetchRecentFills,
  extractTopTraders,
  fetchTraderFills,
  fetchResolvedMarkets,
  fetchMarketsForFillIds,
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
  calibrationScore: number | null;
  calibrationSampleSize: number;
  lastUpdated: number;
}

export interface WhaleLeaderboardPayload {
  whales: WhaleLeaderboardEntry[];
  count: number;
  generatedAt: string | null;
}

/** Parse `/api/whales` JSON without dropping generatedAt. */
export function parseWhaleLeaderboardPayload(body: unknown): WhaleLeaderboardPayload {
  const obj = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const whales = Array.isArray(obj.whales) ? (obj.whales as WhaleLeaderboardEntry[]) : [];
  const count = typeof obj.count === "number" && Number.isFinite(obj.count)
    ? obj.count
    : whales.length;
  const generatedAt =
    typeof obj.generatedAt === "string" && obj.generatedAt.length > 0
      ? obj.generatedAt
      : null;
  return { whales, count, generatedAt };
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

      const traderMarketMap = await fetchMarketsForFillIds(
        traderFills.map((f) => f.market),
        marketMap,
        signal,
      );
      const marketPnL = await computePerMarketPnL(address, traderFills, traderMarketMap, signal);
      if (marketPnL.length === 0) continue;

      const marketResults: MarketResult[] = marketPnL.map((r) => ({
        marketId: r.marketId,
        marketType: r.marketType,
        pnl: r.pnl,
        isUp: r.isUp,
        ...(r.won !== undefined ? { won: r.won } : {}),
      }));

      const score: SkillScoreResult = computeSkillScore({
        address,
        settledMarkets: marketResults,
      });

      const calibrationFills = traderFills.flatMap((fill) => {
        const market = traderMarketMap.get(fill.market.toLowerCase());
        const fillSide = fill.takerSide ?? fill.takerOrder?.side;
        if (!market || market.winningOutcome === null || market.voided || !fillSide || !fill.fillPrice) {
          return [];
        }
        if (!Number.isInteger(market.quoteDecimals) || !market.asset || !market.interval) return [];
        const scale = 10 ** market.quoteDecimals;
        const yesProbability = Number(fill.fillPrice) / scale;
        const isNoSide = fillSide === "BUY_NO" || fillSide === "SELL_YES";
        return [{
          fillPrice: isNoSide ? 1 - yesProbability : yesProbability,
          won: isNoSide ? market.winningOutcome === 1 : market.winningOutcome === 0,
          marketType: `${market.asset}_${market.interval}`,
        }];
      });
      const calibrationBuckets = buildCalibrationBuckets(calibrationFills);
      const calibrationScore = Array.isArray(calibrationBuckets) && calibrationBuckets.length > 0
        ? computeCalibrationScore(calibrationBuckets)
        : null;

      entries.push({
        address: score.address,
        score: score.score,
        winRate: score.winRate,
        bayesianWinRate: score.bayesianWinRate,
        consistencyFactor: score.consistencyFactor,
        variancePenalty: score.variancePenalty,
        totalMarkets: score.totalMarkets,
        totalRealizedPnL: score.totalRealizedPnL,
        calibrationScore,
        calibrationSampleSize: calibrationFills.length,
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
