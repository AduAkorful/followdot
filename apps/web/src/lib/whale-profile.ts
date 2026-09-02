/**
 * Whale profile data — fetches detailed per-whale data: trade history,
 * open positions, skill-scored market breakdown, edge-at-entry (F7),
 * and probability calibration (F8).
 */
import {
  computeSkillScore,
  computeEdgeBps,
  computeFairValue,
  ewmaVolatility,
  buildCalibrationBuckets,
  computeCalibrationScore,
  type MarketResult,
  type SkillScoreResult,
  type CalibrationResult,
  type CalibrationBucket,
} from "@followdot/skill-score";
import {
  fetchTraderFills,
  fetchResolvedMarkets,
  fetchMarketOpeningPrice,
  fetchMarkPriceHistory,
  fetchTraderOpenPositions,
  buildMarketMap,
  computePerMarketPnL,
} from "./dreamdex";
import type { FillRow, BinaryMarket } from "@somnia-chain/markets-sdk";

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

/** Edge-at-entry for a single fill (F7). */
export interface EdgeAtEntry {
  fillId: string;
  marketId: string;
  fillPrice: number;
  fairValue: number | null; // null when live opening/volatility data is unavailable
  edgeBps: number | null; // null when fairValue unavailable
  unavailableReason?: string;
}

export interface WhaleProfileData {
  address: string;
  score: SkillScoreResult;
  marketPnL: WhaleMarketPnL[];
  fills: FillRow[];
  openPositions: Array<{
    marketId: string;
    pool: string;
    marketAddress: string;
    marketType: string;
    side: "BUY_YES" | "BUY_NO";
    stakeHuman: number;
    currentValueHuman: number;
    unrealizedPnlHuman: number;
    quoteDecimals: number;
  }>;
  winRateByMarketType: MarketTypeWinRate[];
  /** F7: edge at entry per fill, keyed by fill.id */
  edges: Map<string, EdgeAtEntry>;
  /** F8: calibration result across all fills */
  calibration: CalibrationResult | null;
  /** F8: calibration score per market type */
  calibrationByMarketType: Map<string, CalibrationResult>;
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
  const openPositions = (await fetchTraderOpenPositions(normalizedAddr)).flatMap((position) => {
    const decimals = position.market.quoteDecimals;
    const yesHeld = position.balanceYes > 0n;
    const noHeld = position.balanceNo > 0n;
    if (yesHeld === noHeld || !Number.isInteger(decimals)) return [];
    return {
      marketId: position.market.id,
      pool: position.market.poolAddress,
      marketAddress: position.market.marketAddress,
      marketType: position.market.asset && position.market.interval
        ? `${position.market.asset}_${position.market.interval}`
        : "unavailable",
      side: yesHeld ? "BUY_YES" as const : "BUY_NO" as const,
      stakeHuman: Number(position.costBasis) / 10 ** decimals,
      currentValueHuman: Number(position.markValue) / 10 ** decimals,
      unrealizedPnlHuman: Number(position.unrealizedPnl) / 10 ** decimals,
      quoteDecimals: decimals,
    };
  });

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
      openPositions,
      winRateByMarketType: [],
      edges: new Map(),
      calibration: null,
      calibrationByMarketType: new Map(),
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

  // F7: Compute edge at entry for each fill
  const edges = await computeEdges(fills, marketMap, signal);

  // F8: Compute calibration (overall + per-market-type)
  // Each fill contributes its implied probability (fillPrice) and resolution outcome
  const calibrationFills = fills.flatMap((f) => {
    const market = marketMap.get(f.market.toLowerCase());
    const fillSide = f.takerSide ?? f.takerOrder?.side;
    if (!market || market.winningOutcome === null || market.voided || !fillSide || !f.fillPrice) {
      return [];
    }
    const scale = 10 ** market.quoteDecimals;
    const yesProbability = Number(f.fillPrice) / scale;
    const isNoSide = fillSide === "BUY_NO" || fillSide === "SELL_YES";
    if (!market.asset || !market.interval) return [];
    const marketType = `${market.asset}_${market.interval}`;
    return [{
      fillPrice: isNoSide ? 1 - yesProbability : yesProbability,
      won: (isNoSide ? market.winningOutcome === 1 : market.winningOutcome === 0),
      marketType,
    }];
  });

  // Overall calibration
  const overallBuckets = buildCalibrationBuckets(calibrationFills) as CalibrationBucket[];
  const overallMAD =
    overallBuckets.length === 0
      ? 0
      : overallBuckets.reduce((sum, b) => sum + Math.abs(b.actualWinRate - b.midpoint), 0) /
        overallBuckets.length;
  const calibration: CalibrationResult | null = overallBuckets.length === 0 ? null : {
    score: computeCalibrationScore(overallBuckets),
    buckets: overallBuckets,
    meanAbsDeviation: overallMAD,
  };

  // Per-market-type calibration
  const calibrationByMarketType = new Map<string, CalibrationResult>();
  const typeBuckets = buildCalibrationBuckets(calibrationFills, { byMarketType: true });
  if (typeBuckets instanceof Map) {
    for (const [marketType, buckets] of typeBuckets) {
      if (buckets.length === 0) continue;
      const mad = buckets.reduce(
        (sum: number, b: { actualWinRate: number; midpoint: number }) =>
          sum + Math.abs(b.actualWinRate - b.midpoint),
        0,
      ) / buckets.length;
      calibrationByMarketType.set(marketType, {
        score: computeCalibrationScore(buckets),
        buckets,
        meanAbsDeviation: mad,
      });
    }
  }

  return {
    address: normalizedAddr,
    score,
    marketPnL,
    fills,
    openPositions,
    winRateByMarketType,
    edges,
    calibration,
    calibrationByMarketType: calibrationByMarketType,
  };
}

/**
 * Compute edge at entry for each fill (F7).
 *
 * For each fill:
 * 1. Get S0 (opening price) from getOpeningPrices or BinaryMarket metadata
 * 2. Get sigma (EWMA volatility) from candle close prices
 * 3. Compute tau (time to expiry at fill time) from market expiry
 * 4. Compute fairValue = computeFairValue(S0, fillPrice, sigma, tau)
 * 5. Compute edgeBps = computeEdgeBps(fillPrice, fairValue)
 *
 * If live inputs are unavailable, the edge remains unavailable. No guessed
 * probability is substituted.
 */
async function computeEdges(
  fills: FillRow[],
  marketMap: Map<string, BinaryMarket>,
  signal?: AbortSignal,
): Promise<Map<string, EdgeAtEntry>> {
  const edges = new Map<string, EdgeAtEntry>();

  for (const fill of fills) {
    if (signal?.aborted) break;

    const marketId = fill.market.toLowerCase();
    const market = marketMap.get(marketId);
    const result: EdgeAtEntry = {
      fillId: fill.id,
      marketId: fill.market,
      fillPrice: 0,
      fairValue: null,
      edgeBps: null,
      unavailableReason: undefined,
    };
    const fillSide = fill.takerSide ?? fill.takerOrder?.side;
    if (!market || !fill.fillPrice || !fillSide || !Number.isInteger(market.quoteDecimals)) {
      result.unavailableReason = "Live market, side, or price metadata unavailable";
      edges.set(fill.id, result);
      continue;
    }
    const fillPriceRaw = Number(fill.fillPrice);
    const scale = 10 ** market.quoteDecimals;
    const fillYes = fillPriceRaw / scale;
    const isNoSide = fillSide === "BUY_NO" || fillSide === "SELL_YES";
    const selectedFillPrice = isNoSide ? 1 - fillYes : fillYes;

    result.fillPrice = selectedFillPrice;

    try {
      // Opening and fill prices are raw YES probabilities in the SDK.
      const openingPriceRaw = await fetchMarketOpeningPrice(fill.market);
      const openingYes = openingPriceRaw === null ? null : openingPriceRaw / scale;
      const S0 = openingYes === null ? null : (isNoSide ? 1 - openingYes : openingYes);

      // sigma: EWMA volatility from candle close prices
      const intervalSec = market.intervalSec ? Number(market.intervalSec) : null;
      if (!intervalSec || intervalSec <= 0) {
        result.unavailableReason = "Market interval unavailable";
        edges.set(fill.id, result);
        continue;
      }
      const priceHistoryRaw = await fetchMarkPriceHistory(
        fill.pool,
        intervalSec,
        {
          from: fill.timestamp ? Number(fill.timestamp) : undefined,
          limit: 50,
        },
      );
      const priceHistory = priceHistoryRaw.map((price) => {
        const yesPrice = price / scale;
        return isNoSide ? 1 - yesPrice : yesPrice;
      });

      // tau: time to expiry at fill (seconds → years)
      const tauSeconds = market.expiry && fill.timestamp
        ? Number(market.expiry) - Number(fill.timestamp)
        : null;
      const tauYears = tauSeconds !== null && tauSeconds > 0 ? tauSeconds / (365 * 24 * 3600) : null;

      // Compute fair value
      let fairValue: number | null = null;
      let edgeBps: number | null = null;
      if (S0 !== null && S0 > 0 && priceHistory.length > 0) {
        const sigma = ewmaVolatility(priceHistory);
        if (sigma > 0 && tauYears !== null && tauYears > 0) {
          fairValue = computeFairValue(S0, selectedFillPrice, sigma, tauYears);
          if (Number.isFinite(fairValue)) {
            edgeBps = computeEdgeBps(selectedFillPrice, fairValue);
          }
        }
      }

      result.fairValue = fairValue;
      result.edgeBps = edgeBps;
      result.unavailableReason = edgeBps === null
        ? "Live opening price or mark-price volatility unavailable"
        : undefined;
      edges.set(fill.id, result);
    } catch (err) {
      console.warn(
        `[whale-profile] Failed to compute edge for fill ${fill.id}:`,
        err instanceof Error ? err.message : String(err),
      );

      result.unavailableReason = "Live edge inputs unavailable";
      edges.set(fill.id, result);
    }
  }

  return edges;
}
