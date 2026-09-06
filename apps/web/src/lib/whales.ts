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
  fetchResolvedMarkets,
  buildMarketMap,
  computePerMarketPnL,
} from "./dreamdex";
import type { FillRow } from "@somnia-chain/markets-sdk";

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

/** Fresh window before we prefer a background refresh. */
export const WHALE_LEADERBOARD_FRESH_MS = 30_000;
/** Serve stale while a refresh runs (stale-while-revalidate). */
export const WHALE_LEADERBOARD_STALE_MS = 120_000;
/** Cap concurrent whale score pipelines (fills + PnL + skill). */
const WHALE_SCORE_CONCURRENCY = 10;
/** Leaderboard fill budget — 2 pages is enough for skill ranking. */
const LEADERBOARD_FILL_LIMIT = 200;

type LeaderboardCacheEntry = {
  expiresAt: number;
  staleUntil: number;
  payload: WhaleLeaderboardPayload;
  inflight: Promise<WhaleLeaderboardPayload> | null;
};

const leaderboardCache = new Map<number, LeaderboardCacheEntry>();

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

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      if (signal?.aborted) break;
      const i = next++;
      if (i >= items.length) break;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

async function scoreTrader(
  address: string,
  traderFills: FillRow[],
  marketMap: ReturnType<typeof buildMarketMap>,
  signal?: AbortSignal,
): Promise<WhaleLeaderboardEntry | null> {
  if (traderFills.length === 0) return null;

  // Leaderboard only needs settled markets already in marketMap — skip the
  // N+1 getBinaryMarket fan-out (fetchMarketsForFillIds) that was blocking TTFB.
  const marketPnL = await computePerMarketPnL(
    address,
    traderFills,
    marketMap,
    signal,
    { preferSettledFills: true },
  );
  if (marketPnL.length === 0) return null;

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
    const market = marketMap.get(fill.market.toLowerCase());
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

  return {
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
  };
}

/**
 * Fetch the whale leaderboard from the real DreamDEX indexer.
 *
 * Pipeline:
 *   1. Fetch resolved binary markets + recent fills in parallel
 *   2. Discover top trader addresses
 *   3. Score traders concurrently (bounded) using settled-fill PnL (no balance RPC)
 *   4. Sort by score descending
 *
 * No mock data. If the indexer returns no fills or no resolved markets,
 * the result is an empty array — never placeholder data.
 */
export async function fetchWhaleLeaderboard(
  limit = 20,
  signal?: AbortSignal,
): Promise<WhaleLeaderboardEntry[]> {
  const t0 = Date.now();

  // Step 1+2 — resolved markets and discovery fills in parallel.
  // Score from the discovery fill window (no per-wallet fill N+1): the same
  // fills used to rank traders already contain their recent binary activity.
  const [markets, fills] = await Promise.all([
    fetchResolvedMarkets(signal),
    fetchRecentFills(1000, signal),
  ]);
  const marketMap = buildMarketMap(markets);
  const traderAddresses = extractTopTraders(fills, limit);

  if (traderAddresses.length === 0) return [];

  const fillsByTrader = new Map<string, FillRow[]>();
  const seenFillIds = new Map<string, Set<string>>();
  for (const fill of fills) {
    for (const raw of [fill.maker, fill.taker, fill.takerOrder?.owner ?? null]) {
      if (!raw || !/^0x[a-fA-F0-9]{40}$/.test(raw)) continue;
      const addr = raw.toLowerCase();
      const seen = seenFillIds.get(addr) ?? new Set<string>();
      if (seen.has(fill.id)) continue;
      seen.add(fill.id);
      seenFillIds.set(addr, seen);
      const bucket = fillsByTrader.get(addr);
      if (bucket) bucket.push(fill);
      else fillsByTrader.set(addr, [fill]);
    }
  }

  const scored = await mapPool(
    traderAddresses,
    WHALE_SCORE_CONCURRENCY,
    async (address) => {
      if (signal?.aborted) return null;
      try {
        const traderFills = (fillsByTrader.get(address.toLowerCase()) ?? []).slice(
          0,
          LEADERBOARD_FILL_LIMIT,
        );
        return await scoreTrader(address, traderFills, marketMap, signal);
      } catch (err) {
        console.error(
          `[whales] Failed to score trader ${address}:`,
          err instanceof Error ? err.message : String(err),
        );
        return null;
      }
    },
    signal,
  );

  const entries = scored.filter((e): e is WhaleLeaderboardEntry => e != null);
  const sorted = entries.sort((a, b) => b.score - a.score);
  console.info(
    `[whales] leaderboard limit=${limit} traders=${traderAddresses.length} scored=${sorted.length} markets=${markets.length} ${Date.now() - t0}ms`,
  );
  return sorted;
}

async function buildLeaderboardPayload(
  limit: number,
  signal?: AbortSignal,
): Promise<WhaleLeaderboardPayload> {
  const whales = await fetchWhaleLeaderboard(limit, signal);
  return {
    whales,
    count: whales.length,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * In-process stale-while-revalidate cache for `/api/whales`.
 * Local Next and single-node deploys have no shared edge cache that helps
 * the first browser hit (`cache: "no-store"`), so this is what keeps TTFB low.
 */
export async function getCachedWhaleLeaderboard(
  limit = 20,
  signal?: AbortSignal,
): Promise<WhaleLeaderboardPayload & { cache: "fresh" | "stale" | "miss" }> {
  const key = limit;
  const now = Date.now();
  const cached = leaderboardCache.get(key);

  if (cached && now < cached.expiresAt) {
    return { ...cached.payload, cache: "fresh" };
  }

  if (cached && now < cached.staleUntil) {
    if (!cached.inflight) {
      const refresh = buildLeaderboardPayload(limit)
        .then((payload) => {
          leaderboardCache.set(key, {
            expiresAt: Date.now() + WHALE_LEADERBOARD_FRESH_MS,
            staleUntil: Date.now() + WHALE_LEADERBOARD_STALE_MS,
            payload,
            inflight: null,
          });
          return payload;
        })
        .catch((err) => {
          console.error(
            "[whales] background refresh failed:",
            err instanceof Error ? err.message : String(err),
          );
          const entry = leaderboardCache.get(key);
          if (entry) entry.inflight = null;
          return cached.payload;
        });
      cached.inflight = refresh;
    }
    return { ...cached.payload, cache: "stale" };
  }

  if (cached?.inflight) {
    const payload = await cached.inflight;
    return { ...payload, cache: "miss" };
  }

  const inflight = buildLeaderboardPayload(limit, signal);
  leaderboardCache.set(key, {
    expiresAt: 0,
    staleUntil: 0,
    payload: { whales: [], count: 0, generatedAt: null },
    inflight,
  });

  try {
    const payload = await inflight;
    leaderboardCache.set(key, {
      expiresAt: Date.now() + WHALE_LEADERBOARD_FRESH_MS,
      staleUntil: Date.now() + WHALE_LEADERBOARD_STALE_MS,
      payload,
      inflight: null,
    });
    return { ...payload, cache: "miss" };
  } catch (err) {
    leaderboardCache.delete(key);
    throw err;
  }
}
