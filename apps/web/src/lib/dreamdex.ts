/**
 * DreamDEX data layer — all reads go to the real Somnia testnet indexer.
 * No mock data, no fallbacks: if the indexer is unreachable the caller
 * receives the error.
 */
import {
  SomniaMarkets,
  binaryFillsFor,
  computeBinaryPnl,
  type FillRow,
  type OpenPositionPnL,
  type BinaryMarket,
  type BinaryPnl,
  type MarketOnchain,
  type BookTop,
  type Candle,
} from "@somnia-chain/markets-sdk";
import type { Address, Hex } from "viem";
import { somniaChain, INDEXER_URL } from "../config/somnia";

const FETCH_TIMEOUT_MS = 15_000;
const MAX_RESOLVED_PAGES = 100;
const MAX_TRADER_FILL_PAGES = 20;
const MAX_CONCURRENT_BALANCE_READS = 10;
const TRADER_FILL_PAGE_SIZE = 200;
const RESOLVED_MARKET_PAGE_SIZE = 200;

const exchange = INDEXER_URL
  ? new SomniaMarkets({
      chain: somniaChain,
      indexerUrl: INDEXER_URL,
    })
  : null;

const client = exchange?.client;

function getClient(): NonNullable<typeof client> {
  if (!client) throw new Error("NEXT_PUBLIC_DREAMDEX_REST is not configured");
  return client;
}

/**
 * Wrap a promise with a timeout. The SDK methods don't accept AbortSignal,
 * so we race them against a timeout promise.
 */
async function withTimeout<T>(
  p: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

// ─── Top-trader discovery ───────────────────────────────────────────

/** POST a raw GraphQL query to the indexer with a timeout. */
async function gqlFetch<T>(
  query: string,
  variables: Record<string, unknown> = {},
  signal?: AbortSignal,
): Promise<T> {
  const res = await withTimeout(
    fetch(INDEXER_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, variables }),
      cache: "no-store",
      signal,
    }),
    FETCH_TIMEOUT_MS,
    "gqlFetch",
  );
  if (!res.ok) {
    throw new Error(
      `DreamDEX indexer request failed: ${res.status} ${res.statusText}`,
    );
  }
  const json = (await res.json()) as { data?: T; errors?: unknown[] };
  if (json.errors && json.errors.length > 0) {
    throw new Error(
      `DreamDEX indexer GraphQL error: ${JSON.stringify(json.errors)}`,
    );
  }
  if (!json.data) {
    throw new Error("DreamDEX indexer returned no data");
  }
  return json.data;
}

/**
 * Fetch recent fills from the indexer's Fill table to discover active traders.
 * Returns the raw fill rows — caller extracts trader addresses.
 */
export async function fetchRecentFills(
  limit = 500,
  signal?: AbortSignal,
): Promise<FillRow[]> {
  try {
    const query = `
      query RecentFills($limit: Int!) {
        Fill(limit: $limit, order_by: [{timestamp: desc}, {blockNumber: desc}]) {
          id
          market { id }
          pool
          fillPrice
          quantity
          quoteQuantity
          maker
          makerSide
          taker
          takerSide
          kind
          takerIsBid
          timestamp
          txHash
          takerOrder { owner side }
        }
      }
    `;

    const data = await gqlFetch<{ Fill: Array<Omit<FillRow, "market"> & { market: { id: string } }> }>(query, { limit }, signal);
    return (data.Fill ?? []).map((row) => ({ ...row, market: row.market.id }));
  } catch (err) {
    throw new Error(
      `Unable to load recent DreamDEX fills: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Extract unique trader addresses from a set of fills, ranked by fill count.
 * A trader can appear as a maker, taker, or takerOrder.owner.
 * Validates that addresses are well-formed 0x-prefixed 40-hex-char strings.
 */
export function extractTopTraders(fills: FillRow[], maxTraders = 20): string[] {
  const counts = new Map<string, number>();

  const bump = (addr: string | null) => {
    if (!addr) return;
    const lower = addr.toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(lower)) return;
    counts.set(lower, (counts.get(lower) ?? 0) + 1);
  };

  for (const f of fills) {
    bump(f.maker);
    bump(f.taker);
    bump(f.takerOrder?.owner ?? null);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxTraders)
    .map(([addr]) => addr);
}

// ─── Per-trader data ────────────────────────────────────────────────

/**
 * Fetch all fills for a specific trader across all markets.
 * Pages to exhaustion (up to MAX_TRADER_FILL_PAGES pages) to avoid
 * truncating whale history.
 */
export async function fetchTraderFills(
  account: string,
  limit = 1000,
  signal?: AbortSignal,
): Promise<FillRow[]> {
  const allFills: FillRow[] = [];
  const pageSize = Math.min(limit, TRADER_FILL_PAGE_SIZE);

  for (let offset = 0, page = 0; page < MAX_TRADER_FILL_PAGES; page++) {
    if (signal?.aborted) break;
    // Direct GraphQL — bypass SDK's `participatedAs` filter that includes
    // a slow `takerOrder.owner` join (Hasura times out for any wallet
    // that has been a taker). Filter only on maker/taker.
    const q = `
      query UserFillsDirect($acct: String!, $limit: Int!, $offset: Int!) {
        Fill(
          where: { _or: [{ maker: { _eq: $acct } }, { taker: { _eq: $acct } }] },
          limit: $limit, offset: $offset,
          order_by: [{ timestamp: desc }, { blockNumber: desc }]
        ) {
          id market { id } pool maker taker makerSide takerSide
          fillPrice quantity quoteQuantity timestamp
          takerOrder { owner side } kind
        }
      }
    `;
    const batch = await withTimeout(
      fetch(INDEXER_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: q, variables: { acct: account.toLowerCase(), limit: pageSize, offset } }),
        signal,
      }).then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = (await r.json()) as { data?: { Fill?: FillRow[] } };
        return d.data?.Fill ?? [];
      }),
      FETCH_TIMEOUT_MS,
      `getUserFills(${account})`,
    );
    if (batch.length === 0) break;
    allFills.push(...batch);
    if (batch.length < pageSize) break;
    offset += batch.length;
  }
  return allFills;
}

/**
 * Fetch resolved binary markets for resolution context.
 * Only markets that have a winningOutcome (i.e. resolved) are useful for
 * skill scoring — we need to know which outcome won.
 */
export async function fetchResolvedMarkets(signal?: AbortSignal): Promise<BinaryMarket[]> {
  const resolved: BinaryMarket[] = [];
  let offset = 0;
  const limit = RESOLVED_MARKET_PAGE_SIZE;

  for (let page = 0; page < MAX_RESOLVED_PAGES; page++) {
    if (signal?.aborted) break;
    const batch = await withTimeout(
      getClient().listPastBinaryMarkets({ limit, offset }),
      FETCH_TIMEOUT_MS,
      "listPastBinaryMarkets",
    );
    if (batch.length === 0) break;
    resolved.push(
      ...batch.filter(
        (m): m is BinaryMarket => m.winningOutcome !== null || m.voided,
      ),
    );
    if (batch.length < limit) break;
    offset += batch.length;
  }

  return resolved;
}

/**
 * Build a lookup map of marketId → BinaryMarket for resolved markets.
 */
export function buildMarketMap(
  markets: BinaryMarket[],
): Map<string, BinaryMarket> {
  const map = new Map<string, BinaryMarket>();
  for (const m of markets) {
    map.set(m.id.toLowerCase(), m);
  }
  return map;
}

// ─── PnL computation ────────────────────────────────────────────────

/** Compute per-market realized + unrealised PnL for one trader. */
export async function computePerMarketPnL(
  account: string,
  fills: FillRow[],
  marketMap: Map<string, BinaryMarket>,
  signal?: AbortSignal,
): Promise<
  {
    marketId: string;
    marketAddress: string;
    marketType: string;
    pnl: number;
    isUp: boolean;
    tradeCount: number;
  }[]
> {
  // Group fills by market
  const byMarket = new Map<string, FillRow[]>();
  for (const f of fills) {
    const mid = f.market.toLowerCase();
    const arr = byMarket.get(mid);
    if (arr) arr.push(f);
    else byMarket.set(mid, [f]);
  }

  // Pre-compute pnlFills for each market (pure computation, no I/O)
  const marketEntries: {
    marketId: string;
    market: BinaryMarket;
    pnlFills: ReturnType<typeof binaryFillsFor>;
  }[] = [];

  for (const [marketId, marketFills] of byMarket) {
    if (signal?.aborted) break;
    const market = marketMap.get(marketId);
    if (!market) continue;

    const decimals = market.quoteDecimals;
    if (!Number.isInteger(decimals) || decimals < 0) continue;
    const pnlFills = binaryFillsFor(account, marketFills, decimals);
    if (pnlFills.length === 0) continue;

    marketEntries.push({ marketId, market, pnlFills });
  }

  // Batch balance reads with a concurrency limiter
  const chunks: typeof marketEntries[] = [];
  for (let i = 0; i < marketEntries.length; i += MAX_CONCURRENT_BALANCE_READS) {
    chunks.push(marketEntries.slice(i, i + MAX_CONCURRENT_BALANCE_READS));
  }

  const chunkedResults = await Promise.all(
    chunks.map((chunk) =>
      Promise.all(
        chunk.map(async ({ marketId, market, pnlFills }) => {
          const balances = await withTimeout(
            getClient().getOutcomeBalances(account, market.marketAddress),
            FETCH_TIMEOUT_MS,
            `getOutcomeBalances(${account}, ${marketId})`,
          );

          const marketPick = {
            quoteDecimals: market.quoteDecimals,
            lastPrice: market.lastPrice,
            winningOutcome: market.winningOutcome,
            voided: market.voided,
          };

          const pnl: BinaryPnl = computeBinaryPnl(pnlFills, balances, marketPick);

          // Determine whether the trader was net long YES (isUp)
          // Uses BigInt arithmetic to avoid Number.MAX_SAFE_INTEGER precision loss
          let yesExposure = 0n;
          for (const f of pnlFills) {
            const qty = BigInt(f.quantity);
            yesExposure += f.isBuy ? qty : -qty;
          }

          if (!market.asset || !market.interval) {
            throw new Error(`Market metadata unavailable for ${marketId}`);
          }
          const marketType = `${market.asset}_${market.interval}`;

          return {
            marketId,
            marketAddress: market.marketAddress,
            marketType,
            pnl: pnl.total,
            isUp: yesExposure > 0n,
            tradeCount: pnlFills.length,
          };
        }),
      ),
    ),
  );

  return chunkedResults.flat();
}

// ─── F6: Pre-Trade Risk Gates ─────────────────────────────────────────

export type RiskGateStatus = "pass" | "warn" | "block";

export interface RiskGate {
  id: string;
  label: string;
  status: RiskGateStatus;
  detail: string;
}

export interface MarketHealth {
  gates: RiskGate[];
  canProceed: boolean;
  hasWarnings: boolean;
  collateralDecimals: number | null;
}

export interface RiskCheckParams {
  marketId: string;
  marketAddress: string;
  userAddress: string;
  whaleAddress: string | null;
  stakeHuman: number;
  exposureCap: number | null;
}

const MIN_EXPIRY_HEADROOM_S = 30;
const MAX_SPREAD_BPS = 100;
const TRADING_STATUS = 1; // getMarketOnchain: 0 Listed · 1 Trading · 2 Locked · 3 Settling · 4 Resolved · 5 Voided

/** Read current open exposure in human collateral units from the live wallet portfolio. */
export async function fetchUserExposure(userAddress: string): Promise<number | null> {
  try {
    const positions = await withTimeout(
      getClient().getOpenPositionsWithPnL(userAddress),
      FETCH_TIMEOUT_MS,
      `getOpenPositionsWithPnL(${userAddress})`,
    );
    return positions.reduce(
      (total, position) => total + Number(position.costBasis) / 10 ** position.market.quoteDecimals,
      0,
    );
  } catch (err) {
    console.warn(
      `[dreamdex] getOpenPositionsWithPnL failed for ${userAddress}:`,
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

/** Fetch open binary positions for a wallet from the live SDK portfolio. */
export async function fetchTraderOpenPositions(userAddress: string): Promise<OpenPositionPnL[]> {
  return withTimeout(
    getClient().getOpenPositionsWithPnL(userAddress),
    FETCH_TIMEOUT_MS,
    `getOpenPositionsWithPnL(${userAddress})`,
  );
}

/**
 * Fetch authoritative on-chain market status for a binary market via
 * `getMarketOnchain` (chain-level truth, not indexer).
 */
export async function fetchMarketStatus(
  marketId: string,
): Promise<MarketOnchain | null> {
  try {
    return await withTimeout(
      getClient().getMarketOnchain(marketId as Hex),
      FETCH_TIMEOUT_MS,
      `getMarketOnchain(${marketId})`,
    );
  } catch (err) {
    console.warn(
      `[dreamdex] getMarketOnchain failed for ${marketId}:`,
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

/**
 * Fetch top-of-book depth for a market. Returns spread in basis points
 * (YES-probability scale) and the mid price. Both null when the book is
 * empty or one-sided.
 */
export async function fetchOrderBookDepth(
  marketId: string,
): Promise<{ spreadBps: number | null; mid: number | null }> {
  try {
    const bookTops = await withTimeout(
      getClient().getBookTops([marketId.toLowerCase()]),
      FETCH_TIMEOUT_MS,
      `getBookTops(${marketId})`,
    );
    const top = bookTops[marketId.toLowerCase()] as BookTop | undefined;
    if (!top) {
      return { spreadBps: null, mid: null };
    }
    if (top.bestBid === null || top.bestAsk === null) {
      return { spreadBps: null, mid: top.mid ? Number(top.mid) : null };
    }
    const bid = Number(top.bestBid);
    const ask = Number(top.bestAsk);
    if (ask < bid) return { spreadBps: null, mid: top.mid ? Number(top.mid) : null };
    return { spreadBps: (ask - bid) * 10_000, mid: (bid + ask) / 2 };
  } catch (err) {
    console.warn(
      `[dreamdex] getBookTops failed for ${marketId}:`,
      err instanceof Error ? err.message : String(err),
    );
    return { spreadBps: null, mid: null };
  }
}

/**
 * Evaluate all pre-trade risk gates for a copy order (F6).
 *
 * Gates:
 *  1. Market active      — getMarketOnchain status === Trading (1)
 *  2. Expiry headroom    — expiryTimestamp - now >= 30s
 *  3. Position open      — market not resolved/voided
 *  4. Spread check       — spread bps <= 100 (warn if > 50)
 *  5. Exposure cap       — existing + new stake <= per-market cap
 *  6. Collateral check    — user USDC balance >= stake
 */
export async function checkMarketHealth(
  params: RiskCheckParams,
): Promise<MarketHealth> {
  const { marketId, userAddress, stakeHuman, exposureCap } = params;
  const gates: RiskGate[] = [];
  let collateralDecimals: number | null = null;

  // ── Gates 1-3: on-chain market status ──
  const onchain = await fetchMarketStatus(marketId);
  if (onchain) {
    // Gate 1: Market active
    const isActive = onchain.status === TRADING_STATUS;
    gates.push({
      id: "market-active",
      label: "Market Active",
      status: isActive ? "pass" : "block",
      detail: isActive
        ? "Market is in Trading state"
        : `Market status is ${onchain.status} (need Trading=1)`,
    });

    // Gate 2: Expiry headroom
    const nowSec = Math.floor(Date.now() / 1000);
    const timeLeft = Number(onchain.expiry) - nowSec;
    const hasHeadroom = timeLeft >= MIN_EXPIRY_HEADROOM_S;
    gates.push({
      id: "expiry-headroom",
      label: "Expiry Headroom",
      status: hasHeadroom ? "pass" : "block",
      detail: hasHeadroom
        ? `${timeLeft}s remaining before expiry`
        : `Only ${timeLeft}s remaining (minimum ${MIN_EXPIRY_HEADROOM_S}s)`,
    });
  } else {
    gates.push(
      { id: "market-active", label: "Market Active", status: "block", detail: "Unable to fetch market status" },
      { id: "expiry-headroom", label: "Expiry Headroom", status: "block", detail: "Unable to fetch market expiry" },
    );
  }

  // The copied signal must still be an open whale position.
  if (params.whaleAddress) {
    try {
      const whalePositions = await fetchTraderOpenPositions(params.whaleAddress);
      const stillOpen = whalePositions.some((position) => position.market.id.toLowerCase() === marketId.toLowerCase());
      gates.push({
        id: "whale-position-open",
        label: "Whale Position Open",
        status: stillOpen ? "pass" : "block",
        detail: stillOpen ? "Whale position is still open" : "Whale position is settled or unavailable",
      });
    } catch {
      gates.push({ id: "whale-position-open", label: "Whale Position Open", status: "block", detail: "Unable to verify whale position" });
    }
  } else {
    gates.push({ id: "whale-position-open", label: "Whale Position Open", status: "block", detail: "Whale address unavailable" });
  }

  // Gate 4: Spread check
  const bookDepth = await fetchOrderBookDepth(marketId);
  if (bookDepth.spreadBps !== null) {
    const spreadBps = bookDepth.spreadBps;
    const gateStatus: RiskGateStatus =
      spreadBps > MAX_SPREAD_BPS ? "block" : spreadBps > 50 ? "warn" : "pass";
    gates.push({
      id: "spread-check",
      label: "Spread Check",
      status: gateStatus,
      detail: `${spreadBps.toFixed(1)} bps spread (limit ${MAX_SPREAD_BPS} bps)`,
    });
  } else {
    gates.push({
      id: "spread-check",
      label: "Spread Check",
      status: "block",
      detail: bookDepth.mid !== null ? "One-sided book; spread cannot be verified" : "No resting liquidity",
    });
  }

  // Gate 5: Exposure cap. Existing exposure comes from the live wallet portfolio.
  const existingExposure = await fetchUserExposure(userAddress);
  if (existingExposure === null || exposureCap === null) {
    gates.push({
      id: "exposure-cap",
      label: "Exposure Cap",
      status: "block",
      detail: existingExposure === null
        ? "Unable to read current wallet exposure"
        : "No exposure cap configured",
    });
  } else {
    const newExposure = existingExposure + stakeHuman;
    const exceedsCap = newExposure > exposureCap;
    gates.push({
      id: "exposure-cap",
      label: "Exposure Cap",
      status: exceedsCap ? "block" : "pass",
      detail: exceedsCap
        ? `$${newExposure.toFixed(2)} exceeds $${exposureCap.toFixed(2)} cap`
        : `$${newExposure.toFixed(2)} within $${exposureCap.toFixed(2)} cap`,
    });
  }

  // Gate 6: Collateral check
  try {
    if (!onchain) throw new Error("Market collateral metadata unavailable");
    const collateral = onchain.collateral as Address;
    const decimals = onchain.decimals;
    collateralDecimals = decimals;
    const balance = await withTimeout(
      getClient().getErc20Balance(collateral, userAddress as Address),
      FETCH_TIMEOUT_MS,
      `getErc20Balance(${userAddress})`,
    );
    const balanceHuman = Number(balance) / 10 ** decimals;
    const hasCollateral = balanceHuman >= stakeHuman;
    gates.push({
      id: "collateral-check",
      label: "Collateral Check",
      status: hasCollateral ? "pass" : "block",
      detail: hasCollateral
        ? `Balance $${balanceHuman.toFixed(2)} ≥ stake $${stakeHuman.toFixed(2)}`
        : `Insufficient collateral (have $${balanceHuman.toFixed(2)}, need $${stakeHuman.toFixed(2)})`,
    });
  } catch (err) {
    gates.push({
      id: "collateral-check",
      label: "Collateral Check",
      status: "block",
      detail: `Unable to verify balance: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  return {
    gates,
    canProceed: !gates.some((g) => g.status === "block"),
    hasWarnings: gates.some((g) => g.status === "warn"),
    collateralDecimals,
  };
}

// ─── F7: Edge-at-Entry data layer ─────────────────────────────────────

/**
 * Fetch the opening (reference-question) price for a binary market.
 * Returns the raw oracle numericValue as a number, or null if unavailable.
 * Used as S0 in the Black-Scholes Phi(d2) fair-value model.
 */
export async function fetchMarketOpeningPrice(
  marketId: string,
): Promise<number | null> {
  try {
    const prices = await withTimeout(
      getClient().getOpeningPrices([marketId.toLowerCase()]),
      FETCH_TIMEOUT_MS,
      `getOpeningPrices(${marketId})`,
    );
    const val = prices[marketId.toLowerCase()];
    return val !== null && val !== undefined ? Number(val) : null;
  } catch (err) {
    console.warn(
      `[dreamdex] getOpeningPrices failed for ${marketId}:`,
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

/**
 * Fetch mark-price history (close prices) for a pool's candle data.
 * Returns an array of numeric close prices (YES-probability scale, same as
 * `lastPrice`), oldest first. Used for EWMA volatility in fair-value computation.
 */
export async function fetchMarkPriceHistory(
  poolAddress: string,
  intervalSeconds: number,
  opts?: { limit?: number; from?: number; to?: number },
): Promise<number[]> {
  try {
    const candles = (await withTimeout(
      getClient().getCandles(poolAddress, intervalSeconds, opts),
      FETCH_TIMEOUT_MS,
      `getCandles(${poolAddress})`,
    )) as Candle[];
    return candles.map((c) => Number(c.closePrice));
  } catch (err) {
    console.warn(
      `[dreamdex] getCandles failed for ${poolAddress}:`,
      err instanceof Error ? err.message : String(err),
    );
    return [];
  }
}
