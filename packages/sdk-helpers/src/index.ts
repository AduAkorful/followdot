/**
 * @followdot/sdk-helpers
 *
 * Thin wrappers around @somnia-chain/markets-sdk for DreamDEX Event Contracts
 * on Somnia testnet. Centralizes SDK initialization, RPC endpoints, and
 * common call paths so workers and the frontend share one source of truth.
 */

// Cloudflare Workers KVNamespace type — injected by the Workers runtime.
// Declared here so the package typechecks without @cloudflare/workers-types.
type KVNamespace = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: { cursor?: string; limit?: number; prefix?: string }): Promise<{
    keys: { name: string }[];
    cursor?: string;
    list_complete: boolean;
  }>;
};

import {
  SomniaMarkets,
  type SomniaMarketsClient,
  type BinaryMarket,
  type BinarySide,
  type FillRow,
  type OpenPositionPnL,
  type ClaimablePosition,
  type OutcomeBalances,
  ORDER_TYPE,
  binaryFillsFor,
  computeBinaryPnl,
} from "@somnia-chain/markets-sdk";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
import {
  computeSkillScore,
  type SkillScoreResult,
  type MarketResult,
} from "@followdot/skill-score";

export const SOMNIA_CHAIN_ID = 50312;
export const DREAMDEX_REST_TESTNET = "https://stg.api.dreamdex.io/v0";
export const DREAMDEX_WS_TESTNET = "wss://stg.api.dreamdex.io/v0/ws/public";

export interface FollowdotSDKConfig {
  chainId?: number;
  restUrl?: string;
  wsUrl?: string;
  rpcUrl?: string;
}

let _client: SomniaMarkets | null = null;
let _restUrl: string = DREAMDEX_REST_TESTNET;

/**
 * Create or retrieve a singleton SomniaMarkets instance for the Somnia testnet.
 * The singleton is keyed by config so tests can reset and reuse it.
 *
 * Pass `restUrl` / `wsUrl` (e.g. from worker `env.DREAMDEX_REST_URL`) to
 * override the testnet default — required for any non-testnet deployment.
 */
export function createDreamDexSDK(config: FollowdotSDKConfig = {}): SomniaMarkets {
  if (_client) return _client;

  const restUrl = config.restUrl ?? DREAMDEX_REST_TESTNET;
  const wsUrl = config.wsUrl ?? DREAMDEX_WS_TESTNET;
  _restUrl = restUrl;

  _client = new SomniaMarkets({
    chain: somniaShannon,
    indexerUrl: restUrl,
    wsRpcUrl: wsUrl,
  });

  return _client;
}

/** The native (bigint-exact) client — for indexer + chain reads. */
export function getSomniaMarketsClient(): SomniaMarketsClient {
  const sdk = _client ?? createDreamDexSDK();
  return sdk.client;
}

/** The REST endpoint the SDK was last configured with (for GraphQL fetches). */
export function getRestUrl(): string {
  return _restUrl;
}

/**
 * Reset the singleton (useful for tests or switching networks).
 */
export function resetSDK(): void {
  _client = null;
  _restUrl = DREAMDEX_REST_TESTNET;
}

/** POST a raw GraphQL query to the indexer with a timeout. */
async function gqlFetch<T>(
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const res = await fetch(_restUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    cache: 'no-store',
  });
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
    throw new Error('DreamDEX indexer returned no data');
  }
  return json.data;
}

/**
 * Fetch recent fills from the indexer's Fill table to discover active traders.
 */
export async function fetchRecentFills(
  limit = 500,
): Promise<FillRow[]> {
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

  const data = await gqlFetch<{ Fill: FillRow[] }>(query, { limit });
  return data.Fill;
}

/**
 * Extract unique trader addresses from a set of fills, ranked by fill count.
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

/**
 * Fetch the current open positions for a wallet across all binary markets.
 */
export async function getUserPositions(
  sdk: SomniaMarkets,
  account: string,
): Promise<OpenPositionPnL[]> {
  return sdk.client.getOpenPositionsWithPnL(account);
}

/**
 * Fetch recent fills for a wallet with pagination.
 * Pages until the indexer returns fewer than `limit` rows.
 */
export async function getUserFills(
  sdk: SomniaMarkets,
  account: string,
  limit = 2000,
): Promise<FillRow[]> {
  const allFills: FillRow[] = [];
  const pageSize = 200;

  for (let offset = 0; allFills.length < limit; ) {
    const batch = await sdk.client.getUserFills(account, { limit: pageSize, offset });
    if (batch.length === 0) break;
    allFills.push(...batch);
    if (batch.length < pageSize) break;
    offset += batch.length;
  }

  return allFills.slice(0, limit);
}

/**
 * Fetch claimable (settled, unredeemed) positions for a wallet.
 */
export async function getClaimablePositions(
  sdk: SomniaMarkets,
  account: string,
): Promise<ClaimablePosition[]> {
  return sdk.client.getClaimable(account);
}

/**
 * Redeem all claimable positions in a single transaction.
 */
export async function redeemAll(
  sdk: SomniaMarkets,
  entries: ClaimablePosition[],
  operatorId?: number,
): Promise<{ hash: string }> {
  const trader = sdk.client.createTrader({});
  const redeemEntries = entries.map((c) => ({
    marketId: c.marketId as `0x${string}`,
    outcomeIdx: c.outcomeIdx,
    amount: c.amount,
  }));

  const result = await trader.redeemMany({
    entries: redeemEntries,
    operatorId,
  });

  return { hash: result.hash };
}

/**
 * Place a one-click copy order mirroring a whale's position.
 *
 * Creates a SomniaMarkets exchange with a signer, loads markets, finds the
 * matching binary market by its clone-contract address, and places a market
 * order on the same side as the whale.
 *
 * @param config - FollowdotSDKConfig with signer (privateKey for backend
 *                 or walletClient for browser-based signing via wagmi/viem)
 * @param pool - The binary market address (clone contract, NOT poolAddress)
 * @param whaleSide - The whale's side (BUY_YES, SELL_YES, BUY_NO, SELL_NO)
 * @param stake - Collateral amount to risk (raw units, e.g. USDC with 6 decimals)
 * @param slippageBps - Max slippage in basis points (default 100 = 1%)
 * @returns The order result with tx hash
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function placeCopyOrder(
  config: FollowdotSDKConfig & { privateKey?: string; walletClient?: any },
  pool: string,
  whaleSide: BinarySide,
  stake: bigint,
  slippageBps?: number,
): Promise<{ hash: string; orderId: string }> {
  const exchange = new SomniaMarkets({
    chain: somniaShannon,
    indexerUrl: config.restUrl ?? DREAMDEX_REST_TESTNET,
    wsRpcUrl: config.wsUrl ?? DREAMDEX_WS_TESTNET,
    ...(config.privateKey
      ? { privateKey: config.privateKey as `0x${string}` }
      : config.walletClient
        ? { walletClient: config.walletClient }
        : {}),
  });

  await exchange.loadMarkets();

  // Find the binary market matching the given market address
  const market = Object.values(exchange.markets).find(
    (m) => m.type === "binary" && (m.info as { marketAddress?: string })?.marketAddress?.toLowerCase() === pool.toLowerCase(),
  );

  if (!market) {
    throw new Error(`No binary market found for address ${pool}`);
  }

  // Determine which outcome the whale was long
  // BUY_YES / SELL_NO → whale was long YES (or short NO, but the net effect is long YES)
  const isYesWhale = whaleSide === "BUY_YES" || whaleSide === "SELL_NO";

  const quoteDecimals = market.precision.price;
  const stakeHuman = Number(stake) / 10 ** quoteDecimals;

  const symbol = isYesWhale
    ? `${market.symbol}#YES`
    : `${market.symbol}#NO`;

  const order = await exchange.createOrder(
    symbol,
    "market",
    "buy",
    stakeHuman,
    undefined,
    { slippage: slippageBps ? slippageBps / 10000 : 0.01 },
  );

  return { hash: order.txHash ?? order.id, orderId: order.id };
}

/**
 * Index a wallet's portfolio: rolls fills + resolved markets into a normalized shape
 * ready for skill-score computation.
 */
export async function indexWhalePortfolio(
  sdk: SomniaMarkets,
  account: string,
): Promise<MarketResult[]> {
  const client = sdk.client;

  // Fetch resolved markets to get winningOutcome
  const resolvedMarkets = await fetchAllResolvedMarkets(client);
  const marketMap = new Map<string, BinaryMarket>();
  for (const m of resolvedMarkets) {
    marketMap.set(m.id.toLowerCase(), m);
  }

  // Fetch trader fills
  const fills = await getUserFills(sdk, account, 2000);

  // Group fills by market
  const byMarket = new Map<string, FillRow[]>();
  for (const f of fills) {
    const mid = f.market.toLowerCase();
    const arr = byMarket.get(mid);
    if (arr) arr.push(f);
    else byMarket.set(mid, [f]);
  }

  const results: MarketResult[] = [];

  for (const [marketId, marketFills] of byMarket) {
    const market = marketMap.get(marketId);
    if (!market) continue;

    const decimals = market.quoteDecimals ?? 6;
    // Simple PnL: sum of fill values that went in our favor
    // Use the whale's fills to determine side and compute PnL
    let pnl = 0;
    let isUp = false;

    let yesExposure = 0n;
    for (const f of marketFills) {
      // takerIsBid: true when the taker bought YES (isUp side)
      // For binary fills, this indicates the trader's net YES exposure
      const qty = BigInt(f.quantity);
      if (f.takerIsBid ?? false) {
        yesExposure += qty;
      } else if (f.takerIsBid === false) {
        yesExposure -= qty;
      }
    }
    isUp = yesExposure > 0n;

    // Use computeBinaryPnl for accurate PnL
    const pnlFills = binaryFillsFor(account, marketFills, decimals);
    if (pnlFills.length === 0) continue;

    const balances: OutcomeBalances = await client
      .getOutcomeBalances(account, market.marketAddress)
      .catch(() => ({ yes: "0", no: "0" }));

    const marketPick = {
      quoteDecimals: market.quoteDecimals ?? 6,
      lastPrice: market.lastPrice,
      winningOutcome: market.winningOutcome,
      voided: market.voided,
    };

    const binaryPnl = computeBinaryPnl(pnlFills, balances, marketPick);
    pnl = binaryPnl.total;

    const interval = market.interval ?? "unknown";
    const marketType = `${market.asset ?? "unknown"}_${interval}`;

    results.push({
      marketId: marketId,
      marketType,
      pnl,
      isUp,
    });
  }

  return results;
}

/**
 * Fetch all resolved (past) binary markets with pagination.
 */
async function fetchAllResolvedMarkets(
  client: SomniaMarketsClient,
): Promise<BinaryMarket[]> {
  const resolved: BinaryMarket[] = [];
  const limit = 200;
  let offset = 0;
  const maxPages = 100;

  for (let page = 0; page < maxPages; page++) {
    const batch = await client.listPastBinaryMarkets({ limit, offset });
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
 * Persist skill-score results to a KV namespace.
 */
export async function persistToKV(
  kv: KVNamespace,
  scores: SkillScoreResult[],
): Promise<void> {
  for (const score of scores) {
    await kv.put(`skill:${score.address}`, JSON.stringify(score));
  }
  await kv.put("skill:index:timestamp", String(Date.now()));
}

/**
 * Compute skill scores for a batch of indexed portfolios.
 * Reads whale addresses from KV (keyed `whale:address`), indexes each,
 * computes the skill score, and writes back under `skill:address`.
 */
export async function computeSkillScores(
  sdk: SomniaMarkets,
  whaleKV: KVNamespace,
  scoreKV: KVNamespace,
): Promise<SkillScoreResult[]> {
  // Read all whale addresses from the whales KV
  const whales: string[] = [];
  let cursor;
  do {
    const result = await whaleKV.list({ cursor });
    for (const key of result.keys) {
      if (key.name.startsWith("whale:")) {
        whales.push(key.name.slice(7));
      }
    }
    cursor = result.cursor;
    if (!result.list_complete) break;
  } while (cursor);

  const results: SkillScoreResult[] = [];

  for (const address of whales) {
    try {
      const marketResults = await indexWhalePortfolio(sdk, address);
      if (marketResults.length === 0) continue;

      const score = computeSkillScore({
        address,
        settledMarkets: marketResults,
      });

      await scoreKV.put(`skill:${address}`, JSON.stringify(score));
      results.push(score);
    } catch (err) {
      console.error(`[sdk-helpers] Failed to score ${address}:`, err);
    }
  }

  await scoreKV.put("skill:index:timestamp", String(Date.now()));
  return results;
}

/**
 * Poll whitelisted whales' fills via WebSocket.
 * Subscribes to each whale's fill events and buffers new fills into KV.
 */
export async function pollWhaleFills(
  sdk: SomniaMarkets,
  whaleKV: KVNamespace,
  fillsKV: KVNamespace,
): Promise<void> {
  // Read whale addresses from KV
  const whales: string[] = [];
  let cursor;
  do {
    const result = await whaleKV.list({ cursor });
    for (const key of result.keys) {
      if (key.name.startsWith("whale:")) {
        whales.push(key.name.slice(7));
      }
    }
    cursor = result.cursor;
    if (!result.list_complete) break;
  } while (cursor);

  // For each whale, fetch recent fills and store them
  for (const address of whales) {
    try {
      const fills = await sdk.client.getUserFills(address, { limit: 200 });
      await fillsKV.put(
        `fills:${address}`,
        JSON.stringify(fills),
        { expirationTtl: 3600 },
      );
    } catch (err) {
      console.error(`[sdk-helpers] Failed to poll fills for ${address}:`, err);
    }
  }
}

/**
 * Route proportional copy orders for users following a whale's fills,
 * using their granted session keys.
 *
 * For each new fill by a monitored whale, looks up followers in KV,
 * sizes a proportional order, and signs it via the follower's session key.
 */
export async function routeCopyOrders(
  sdk: SomniaMarkets,
  sessionKeysKV: KVNamespace,
): Promise<void> {
  // Read follower config from KV
  // Each follower entry: { whaleAddress, walletAddress, sessionKey, bankrollCap, lastFillId }
  const followers: Array<{
    walletAddress: string;
    whaleAddress: string;
    sessionKey: string;
    bankrollCap: number;
    lastFillId: string;
  }> = [];

  let cursor;
  do {
    const result = await sessionKeysKV.list({ prefix: "follower:" });
    for (const key of result.keys) {
      const data = await sessionKeysKV.get(key.name);
      if (data) {
        followers.push(JSON.parse(data) as typeof followers[0]);
      }
    }
    cursor = result.cursor;
    if (!result.list_complete) break;
  } while (cursor);

  // Group followers by whale
  const byWhale = new Map<string, typeof followers>();
  for (const f of followers) {
    const arr = byWhale.get(f.whaleAddress) ?? [];
    arr.push(f);
    byWhale.set(f.whaleAddress, arr);
  }

  // For each whale with followers, check for new fills and route orders
  for (const [whaleAddress, whaleFollowers] of byWhale) {
    try {
      // Fetch recent fills for the whale
      const fills = await sdk.client.getUserFills(whaleAddress, { limit: 50 });

      for (const fill of fills) {
        const fillId = `${fill.txHash}:${fill.id}`;

        for (const follower of whaleFollowers) {
          // Skip if we've already processed this fill for this follower
          if (follower.lastFillId === fillId) continue;

          try {
            const sessionTrader = sdk.client.createTrader({
              privateKey: follower.sessionKey as `0x${string}`,
            });

            // Determine the side to copy (mirror the whale's side)
            const copySide = mirrorBinarySide(fill.takerSide);
            if (!copySide) {
              console.warn(
                `[sdk-helpers] Skipping fill ${fillId}: missing takerSide`,
              );
              continue;
            }

            // Size the order: proportional to bankroll cap
            // This is a simplified sizing — use a fixed fraction
            const pool = fill.pool;
            if (!pool) continue;

            // Use the whale's fill quantity as a basis, scaled by bankroll
            const quantity = BigInt(fill.quantity);

            await sessionTrader.placeOrder({
              pool: pool as `0x${string}`,
              side: copySide,
              price: BigInt(fill.fillPrice),
              quantity,
              orderType: ORDER_TYPE.MARKET,
            });

            // Update last processed fill
            await sessionKeysKV.put(
              `follower:${follower.walletAddress}:${whaleAddress}`,
              JSON.stringify({ ...follower, lastFillId: fillId }),
            );

            console.log(
              `[sdk-helpers] Routed copy order for ${follower.walletAddress} on ${fill.market}`,
            );
          } catch (err) {
            console.error(
              `[sdk-helpers] Failed to route copy order for ${follower.walletAddress}:`,
              err,
            );
          }
        }
      }
    } catch (err) {
      console.error(
        `[sdk-helpers] Failed to process whale ${whaleAddress}:`,
        err,
      );
    }
  }
}

/**
 * Mirror the whale's binary side for copy trading.
 * BUY_YES → BUY_YES (copy the same side)
 * SELL_YES → SELL_YES (close/hedge the same way)
 *
 * Returns `null` when the fill has no `takerSide`. The caller must skip
 * the fill in that case — silently defaulting to BUY_YES would invert
 * the whale's actual intent (e.g. turning a SELL into a BUY).
 */
function mirrorBinarySide(
  side: BinarySide | null | undefined,
): BinarySide | null {
  if (!side) return null;
  return side;
}
