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
  type BinaryMarket,
  type BinaryPnl,
  type OutcomeBalances,
} from "@somnia-chain/markets-sdk";
import { somniaChain, INDEXER_URL } from "../config/somnia";

const FETCH_TIMEOUT_MS = 15_000;
const MAX_RESOLVED_PAGES = 100;
const MAX_TRADER_FILL_PAGES = 20;
const MAX_CONCURRENT_BALANCE_READS = 10;
const TRADER_FILL_PAGE_SIZE = 200;
const RESOLVED_MARKET_PAGE_SIZE = 200;

const exchange = new SomniaMarkets({
  chain: somniaChain,
  indexerUrl: INDEXER_URL,
});

const client = exchange.client;

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
          market
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

    const data = await gqlFetch<{ Fill: FillRow[] }>(query, { limit }, signal);
    return data.Fill ?? [];
  } catch (err) {
    console.warn("[dreamdex] fetchRecentFills failed:", err instanceof Error ? err.message : String(err));
    return [];
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

  try {
    for (let offset = 0, page = 0; page < MAX_TRADER_FILL_PAGES; page++) {
      if (signal?.aborted) break;
      const batch = await withTimeout(
        client.getUserFills(account, { limit: pageSize, offset }),
        FETCH_TIMEOUT_MS,
        `getUserFills(${account})`,
      );
      if (batch.length === 0) break;
      allFills.push(...batch);
      if (batch.length < pageSize) break;
      offset += batch.length;
    }
    return allFills;
  } catch (err) {
    console.warn(
      `[dreamdex] getUserFills(${account}) failed, trying GraphQL fallback:`,
      err instanceof Error ? err.message : String(err),
    );
    try {
      const query = `
        query TraderFills($account: String!, $limit: Int!) {
          Fill(
            limit: $limit,
            where: { _or: [{ maker: { _eq: $account } }, { taker: { _eq: $account } }] },
            order_by: [{ timestamp: desc }]
          ) {
            id
            market
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
      const data = await gqlFetch<{ Fill: FillRow[] }>(query, { account: account.toLowerCase(), limit }, signal);
      return data.Fill ?? [];
    } catch (gqlErr) {
      console.warn(
        `[dreamdex] GraphQL trader fills fallback failed for ${account}:`,
        gqlErr instanceof Error ? gqlErr.message : String(gqlErr),
      );
      return [];
    }
  }
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

  try {
    for (let page = 0; page < MAX_RESOLVED_PAGES; page++) {
      if (signal?.aborted) break;
      const batch = await withTimeout(
        client.listPastBinaryMarkets({ limit, offset }),
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
  } catch (err) {
    console.warn(
      "[dreamdex] listPastBinaryMarkets failed, proceeding with 0 resolved markets:",
      err instanceof Error ? err.message : String(err),
    );
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

    const decimals = market.quoteDecimals ?? 6;
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
            client.getOutcomeBalances(account, market.marketAddress),
            FETCH_TIMEOUT_MS,
            `getOutcomeBalances(${account}, ${marketId})`,
          ).catch(() => ({ yes: "0", no: "0" }) as OutcomeBalances);

          const marketPick = {
            quoteDecimals: market.quoteDecimals ?? 6,
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

          const interval = market.interval ?? "unknown";
          const marketType = `${market.asset ?? "unknown"}_${interval}`;

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
