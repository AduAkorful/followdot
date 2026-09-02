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
  type MarketOnchain,
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
import {
  FILL_NONCE_TTL_SECONDS,
  fillNonceKey,
  findNextWindowMarket,
  type AutoCopyRule,
  type RollPhase,
  type RollState,
  type SettledMarketInfo,
  transitionRollState,
  shouldHaltAfterWin,
  canOpenPosition,
  maybeRollDayKey,
} from "./roll-state";

export * from "./roll-state";

export const SOMNIA_CHAIN_ID = 50312;

export interface FollowdotSDKConfig {
  chainId?: number;
  restUrl?: string;
  wsUrl?: string;
  rpcUrl?: string;
}

let _client: SomniaMarkets | null = null;
let _restUrl: string | null = null;
let _clientConfigKey: string | null = null;

function requireEndpoint(value: string | undefined, name: string): string {
  if (!value?.trim()) {
    throw new Error(`${name} is not configured`);
  }
  return value;
}

/**
 * Create or retrieve a singleton SomniaMarkets instance for the Somnia testnet.
 * The singleton is keyed by config so tests can reset and reuse it.
 *
 * Pass `restUrl` / `wsUrl` (e.g. from worker `env.DREAMDEX_REST_URL`). Both
 * endpoints are required; missing configuration fails closed.
 */
export function createDreamDexSDK(config: FollowdotSDKConfig = {}): SomniaMarkets {
  const restUrl = requireEndpoint(config.restUrl, "DreamDEX REST URL");
  const wsUrl = requireEndpoint(config.wsUrl, "DreamDEX WS URL");
  const configKey = `${config.chainId ?? SOMNIA_CHAIN_ID}:${restUrl}:${wsUrl}`;
  if (_client && _clientConfigKey === configKey) return _client;
  _restUrl = restUrl;
  _clientConfigKey = configKey;

  _client = new SomniaMarkets({
    chain: somniaShannon,
    indexerUrl: restUrl,
    wsRpcUrl: wsUrl,
  });

  return _client;
}

/** The native (bigint-exact) client — for indexer + chain reads. */
export function getSomniaMarketsClient(): SomniaMarketsClient {
  if (!_client) throw new Error("DreamDEX SDK is not configured");
  return _client.client;
}

/** The REST endpoint the SDK was last configured with (for GraphQL fetches). */
export function getRestUrl(): string {
  if (!_restUrl) throw new Error("DreamDEX REST URL is not configured");
  return _restUrl;
}

/**
 * Reset the singleton (useful for tests or switching networks).
 */
export function resetSDK(): void {
  _client = null;
  _restUrl = null;
  _clientConfigKey = null;
}

/** POST a raw GraphQL query to the indexer with a timeout. */
async function gqlFetch<T>(
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const res = await fetch(getRestUrl(), {
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
    indexerUrl: requireEndpoint(config.restUrl, "DreamDEX REST URL"),
    wsRpcUrl: requireEndpoint(config.wsUrl, "DreamDEX WS URL"),
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
  if (!Number.isInteger(quoteDecimals) || quoteDecimals < 0) {
    throw new Error(`Collateral decimals unavailable for ${pool}`);
  }
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

    const decimals = market.quoteDecimals;
    if (!Number.isInteger(decimals) || decimals < 0 || !market.asset || !market.interval) continue;
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

    const balances: OutcomeBalances = await client.getOutcomeBalances(account, market.marketAddress);

    const marketPick = {
      quoteDecimals: market.quoteDecimals,
      lastPrice: market.lastPrice,
      winningOutcome: market.winningOutcome,
      voided: market.voided,
    };

    const binaryPnl = computeBinaryPnl(pnlFills, balances, marketPick);
    pnl = binaryPnl.total;

    const marketType = `${market.asset}_${market.interval}`;

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
 * Config for `routeCopyOrders`.
 */
export interface RouteCopyOrdersConfig {
  /** Explicit list of follower wallet addresses to process (empty = all in KV). */
  followerAddresses: string[];
  /** If true, no orders are placed — just evaluate and return what *would* happen. */
  dryRun: boolean;
}

/**
 * Result of `routeCopyOrders` — processed fill IDs, errors, and rolled markets.
 */
export interface RouteCopyOrdersResult {
  /** Fill IDs that were processed (or would-be processed in dry-run). */
  processed: string[];
  /** Error messages from failed order placements. */
  errors: string[];
  /** Markets that were rolled (follower:whale:marketId tags). */
  rolled: string[];
}

/**
 * Fetch a market's on-chain state. Returns null if the lookup fails.
 * Uses a try/catch because not all markets will have on-chain data yet.
 */
async function fetchMarketOnchainSafe(
  sdk: SomniaMarkets,
  marketId: string,
): Promise<MarketOnchain | null> {
  try {
    return await sdk.client.getMarketOnchain(marketId as `0x${string}`);
  } catch {
    return null;
  }
}

/** Status string → numeric (matches MarketOnchain.status numbering). */
const STATUS_TO_NUM: Record<string, number> = {
  Listed: 0,
  Trading: 1,
  Locked: 2,
  Settling: 3,
  Resolved: 4,
  Voided: 5,
  Finalized: 6,
};

/**
 * Find the next market-window market for a given resolved market.
 * Fetches live trading markets and delegates to the pure
 * `findNextWindowMarket` from roll-state.ts.
 */
async function findNextWindowMarketCode(
  sdk: SomniaMarkets,
  currentMarketId: string,
  criteria?: { asset?: string; intervalSec?: number },
): Promise<BinaryMarket | null> {
  try {
    const liveMarkets = await sdk.client.listLiveBinaryMarkets({
      status: "Trading",
      limit: 100,
    });
    const candidates = liveMarkets.flatMap((m) => {
      const status = STATUS_TO_NUM[m.status];
      const intervalSec = m.intervalSec ? Number(m.intervalSec) : 0;
      const expiry = Number(m.expiry);
      if (status === undefined || intervalSec <= 0 || !Number.isFinite(expiry) || !m.asset) return [];
      return [{
        marketId: m.id,
        pool: m.poolAddress,
        intervalSec,
        expiry,
        status,
        asset: m.asset,
      }];
    });
    const next = findNextWindowMarket(currentMarketId, candidates, undefined, 30, criteria);
    if (!next) return null;
    return await sdk.client.getBinaryMarket(next.marketId as `0x${string}`);
  } catch (err) {
    console.warn(`[sdk-helpers] Could not find next window market: ${err}`);
    return null;
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

/**
 * Process settled positions for auto-rolling followers.
 *
 * Checks the roll state for the follower-whale pair, fetches the market's
 * on-chain status, and uses the pure `transitionRollState` from roll-state.ts
 * to advance the state machine. Winners are rolled into the next window market;
 * losers trigger stop-loss / halt evaluation.
 */
async function processSettledRolls(
  sdk: SomniaMarkets,
  kv: KVNamespace,
  follower: string,
  whale: string,
  rule: AutoCopyRule,
): Promise<{ rolled: string[]; errors: string[] }> {
  const rolled: string[] = [];
  const errors: string[] = [];
  const activeKey = `roll-active:${follower}:${whale}`;
  const rollRecordKey = await kv.get(activeKey);
  if (!rollRecordKey) return { rolled, errors };
  const rollJson = await kv.get(rollRecordKey);
  if (!rollJson) return { rolled, errors };

  const rollState = JSON.parse(rollJson) as RollState;
  if (rollState.phase !== "OPEN" || !rollState.marketId) {
    return { rolled, errors };
  }

  const onchain = await fetchMarketOnchainSafe(sdk, rollState.marketId);
  if (!onchain) return { rolled, errors };

  const settled: SettledMarketInfo = {
    marketId: rollState.marketId,
    winningOutcome: onchain.winningOutcome as 0 | 1 | null,
    voided: onchain.isVoided,
    resolved: onchain.isResolved,
  };

  // If the market hasn't resolved yet, nothing to do
  if (!settled.resolved && !settled.voided) return { rolled, errors };

  let proceeds = 0n;
  const outcomeIdx = rollState.whaleSide === "BUY_YES" || rollState.whaleSide === "SELL_NO" ? 0 : 1;
  const isWinningSettlement = settled.voided || settled.winningOutcome === outcomeIdx;
  if ((settled.resolved || settled.voided) && isWinningSettlement) {
    try {
      const claimable = await sdk.client.getClaimable(follower);
      const entries = claimable.filter(
        (entry) => entry.marketId.toLowerCase() === rollState.marketId.toLowerCase()
          && entry.amount > 0n
          && (settled.voided || settled.winningOutcome === outcomeIdx),
      );
      if (entries.length === 0) {
        errors.push(`No live claimable position found for ${follower}:${rollState.marketId}`);
        return { rolled, errors };
      }
      const trader = sdk.client.createTrader({
        privateKey: rule.sessionKey as `0x${string}`,
      });
      const balanceBefore = await sdk.client.getErc20Balance(
        onchain.collateral,
        follower as `0x${string}`,
      );
      await trader.redeemMany({
        entries: entries.map((entry) => ({
          marketId: entry.marketId as `0x${string}`,
          outcomeIdx: entry.outcomeIdx,
          amount: entry.amount,
        })),
      });
      const balanceAfter = await sdk.client.getErc20Balance(
        onchain.collateral,
        follower as `0x${string}`,
      );
      proceeds = balanceAfter - balanceBefore;
      if (proceeds <= 0n) throw new Error("Redeemed collateral increase unavailable");
    } catch (err) {
      errors.push(`Redemption failed for ${follower}:${rollState.marketId}: ${err instanceof Error ? err.message : String(err)}`);
      return { rolled, errors };
    }
  }

  const next = transitionRollState(rollState, settled);
  if (proceeds > 0n) {
    next.realizedProceeds = (BigInt(next.realizedProceeds ?? "0") + proceeds).toString();
  }

  const activeRule = maybeRollDayKey(rule);
  activeRule.consecutiveLosses = next.consecutiveLosses;
  if (next.phase === "LOSER" && next.consecutiveLosses >= next.stopLossRounds) {
    next.phase = "HALTED";
  }

  if (next.phase === "WINNER") {
    if (shouldHaltAfterWin(next)) {
      next.phase = "HALTED";
    } else {
      const nextMarket = await findNextWindowMarketCode(sdk, rollState.marketId, {
        asset: rollState.asset,
        intervalSec: rollState.intervalSec,
      });
      if (nextMarket) {
        const stake = proceeds;
        const updatedRule = {
          ...activeRule,
          dailyVolume: BigInt(activeRule.dailyVolume),
        };
        const nextDecimals = nextMarket.quoteDecimals;
        const nextPriceRaw = nextMarket.lastPrice == null ? null : BigInt(nextMarket.lastPrice);
        const priceScale = nextDecimals == null ? null : 10n ** BigInt(nextDecimals);
        const selectedPrice = priceScale === null || nextPriceRaw === null
          ? null
          : (rollState.whaleSide === "BUY_NO" || rollState.whaleSide === "SELL_YES"
            ? priceScale - nextPriceRaw
            : nextPriceRaw);
        const nextQuantity = selectedPrice && selectedPrice > 0n && priceScale !== null
          ? (stake * priceScale) / selectedPrice
          : 0n;
        if (stake > 0n && nextQuantity > 0n && nextMarket.lastPrice != null && canOpenPosition(updatedRule, stake)) {
          try {
            const sessionTrader = sdk.client.createTrader({
              privateKey: rule.sessionKey as `0x${string}`,
            });
            await sessionTrader.placeOrder({
              pool: nextMarket.poolAddress as `0x${string}`,
              side: rollState.whaleSide as BinarySide,
              price: BigInt(nextMarket.lastPrice),
              quantity: nextQuantity,
              orderType: ORDER_TYPE.MARKET,
            });
            next.phase = "OPEN" as RollPhase;
            next.fillId = `roll:${rollState.fillId}:${nextMarket.id}`;
            next.marketId = nextMarket.id;
            next.pool = nextMarket.poolAddress;
            next.stake = stake.toString();
            next.entryPrice = Number(nextMarket.lastPrice) / Number(priceScale);
            next.entryTime = Math.floor(Date.now() / 1000);
            next.rolledFromFillId = rollState.fillId;
            next.initialStake = rollState.initialStake ?? rollState.stake;
            next.asset = nextMarket.asset;
            next.intervalSec = nextMarket.intervalSec ? Number(nextMarket.intervalSec) : undefined;
            updatedRule.dailyVolume += stake;
            updatedRule.roundsToday += 1;
            await kv.put(`follower:${follower}:${whale}`, serializeRule(updatedRule), {
              expirationTtl: FILL_NONCE_TTL_SECONDS,
            });
            const newKey = `roll:${follower}:${whale}:roll-${rollState.fillId}-${nextMarket.id}`;
            await kv.put(newKey, JSON.stringify(next), { expirationTtl: FILL_NONCE_TTL_SECONDS });
            await kv.put(activeKey, newKey, { expirationTtl: FILL_NONCE_TTL_SECONDS });
            await kv.put(rollRecordKey, JSON.stringify({ ...rollState, phase: "WINNER", realizedProceeds: next.realizedProceeds }), {
              expirationTtl: FILL_NONCE_TTL_SECONDS,
            });
            rolled.push(`${follower}:${whale}:${next.marketId}`);
            return { rolled, errors };
          } catch (err) {
            errors.push(
              `Roll order failed for ${follower}: ${err instanceof Error ? err.message : String(err)}`,
            );
            console.error(
              `[sdk-helpers] Auto-roll order failed for ${follower}:`,
              err,
            );
          }
        } else {
          next.phase = "HALTED";
        }
      } else {
        next.phase = "HALTED";
      }
    }
  }

  await kv.put(rollRecordKey, JSON.stringify(next), {
    expirationTtl: FILL_NONCE_TTL_SECONDS,
  });
  await kv.put(`follower:${follower}:${whale}`, serializeRule(activeRule), {
    expirationTtl: FILL_NONCE_TTL_SECONDS,
  });
  if (next.phase !== "OPEN") await kv.delete(activeKey);

  return { rolled, errors };
}

function serializeRule(rule: AutoCopyRule): string {
  return JSON.stringify({
    ...rule,
    dailyVolume: rule.dailyVolume.toString(),
    guardrails: {
      ...rule.guardrails,
      dailyCap: rule.guardrails.dailyCap.toString(),
    },
  });
}

function deserializeRule(data: string): AutoCopyRule {
  const parsed = JSON.parse(data) as Omit<AutoCopyRule, "dailyVolume" | "guardrails"> & {
    dailyVolume: string | number;
    guardrails: Omit<AutoCopyRule["guardrails"], "dailyCap"> & { dailyCap: string | number };
  };
  return {
    ...parsed,
    dailyVolume: BigInt(parsed.dailyVolume),
    guardrails: {
      ...parsed.guardrails,
      dailyCap: BigInt(parsed.guardrails.dailyCap),
    },
  };
}

/** Read all follower rules from KV (key prefix `follower:`). */
async function listFollowers(kv: KVNamespace): Promise<AutoCopyRule[]> {
  const followers: AutoCopyRule[] = [];
  let cursor;
  do {
    const result = await kv.list({ prefix: "follower:", cursor });
    for (const key of result.keys) {
      const data = await kv.get(key.name);
      if (data) {
        try {
          const rule = deserializeRule(data);
          if (rule.walletAddress && rule.whaleAddress && rule.sessionKey) followers.push(rule);
        } catch (err) {
          console.warn(`[sdk-helpers] Ignoring malformed follower record ${key.name}:`, err);
        }
      }
    }
    cursor = result.cursor;
    if (!result.list_complete) break;
  } while (cursor);
  return followers;
}

/**
 * Route proportional copy orders for users following a whale's fills,
 * using their granted session keys.
 *
 * Per-fill nonce guard: each fill is recorded as `processed:{follower}:{whale}:{fillId}`
 * with a 24 h TTL in KV. This fixes audit finding F-01 — the previous `lastFillId`
 * single-pointer approach could double-execute on retries or out-of-order fills.
 *
 * Auto-roll: when `autoRoll` is enabled on the follower rule, winning positions
 * are carried into the next market window using the pure state machine in
 * roll-state.ts (`transitionRollState`, `shouldHaltAfterWin`, `canOpenPosition`,
 * `maybeRollDayKey`, `findNextWindowMarket`).
 */
export async function routeCopyOrders(
  sdk: SomniaMarkets,
  sessionKeysKV: KVNamespace,
  config: RouteCopyOrdersConfig,
): Promise<RouteCopyOrdersResult> {
  const { followerAddresses, dryRun = false } = config;
  const processed: string[] = [];
  const errors: string[] = [];
  const rolled: string[] = [];

  // Build the set of follower-whale pairs to process
  const targetPairs: Array<{
    follower: string;
    whale: string;
    rule: AutoCopyRule;
  }> = [];

  if (followerAddresses.length > 0) {
    for (const follower of followerAddresses) {
      const rules = await listFollowers(sessionKeysKV);
      for (const rule of rules) {
        if (rule.walletAddress.toLowerCase() === follower.toLowerCase() && rule.status !== "PAUSED") {
          targetPairs.push({ follower, whale: rule.whaleAddress, rule });
        }
      }
    }
  } else {
    const rules = await listFollowers(sessionKeysKV);
    for (const rule of rules) {
      if (rule.status === "PAUSED") continue;
      targetPairs.push({
        follower: rule.walletAddress,
        whale: rule.whaleAddress,
        rule,
      });
    }
  }

  // For each unique whale, fetch recent fills (deduplicated)
  const whaleFills = new Map<string, FillRow[]>();
  const whaleErrors = new Map<string, string>();
  for (const { whale } of targetPairs) {
    if (!whaleFills.has(whale)) {
      try {
        const fills = await sdk.client.getUserFills(whale, { limit: 50 });
        whaleFills.set(whale, fills);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        whaleErrors.set(whale, message);
        whaleFills.set(whale, []);
      }
    }
  }

  // Process each follower-whale pair
  for (const { follower, whale, rule } of targetPairs) {
    try {
      if (whaleErrors.has(whale)) {
        errors.push(`${follower}: unable to load whale fills: ${whaleErrors.get(whale)}`);
        continue;
      }
      const fills = whaleFills.get(whale) ?? [];
      const activeRollKey = `roll-active:${follower}:${whale}`;

      // Apply daily day-key rollover for guardrail counters
      let activeRule = maybeRollDayKey(rule);

      for (const fill of fills) {
        const fillId = `${fill.txHash}:${fill.id}`;
        const nonceKey = fillNonceKey(follower, whale, fillId);

        // Per-fill nonce guard — skip if already processed (fixes F-01)
        const alreadyProcessed = await sessionKeysKV.get(nonceKey);
        if (alreadyProcessed === "1") continue;

        try {
          const copySide = mirrorBinarySide(fill.takerSide ?? fill.takerOrder?.side);
          if (!copySide) {
            console.warn(
              `[sdk-helpers] Skipping fill ${fillId}: missing authoritative side`,
            );
            continue;
          }

          const pool = fill.pool;
          if (!pool) continue;

          const liveMarket = await fetchMarketOnchainSafe(sdk, fill.market);
          const nowSec = Math.floor(Date.now() / 1000);
          if (!liveMarket || liveMarket.status !== 1 || Number(liveMarket.expiry) - nowSec < 30) {
            console.warn(`[sdk-helpers] Skipping non-trading or near-expiry fill ${fillId}`);
            continue;
          }

          const sourceMarket = await sdk.client.getBinaryMarket(fill.market as `0x${string}`);
          const quoteDecimals = sourceMarket?.quoteDecimals ?? null;
          if (!sourceMarket || quoteDecimals === null || !Number.isInteger(quoteDecimals) || quoteDecimals < 0 || !fill.quoteQuantity) {
            throw new Error(`Live market quote metadata unavailable for ${fill.market}`);
          }
          const stake = BigInt(fill.quoteQuantity);
          const bankrollCapRaw = BigInt(Math.floor(activeRule.bankrollCap * 10 ** quoteDecimals));
          if (bankrollCapRaw > 0n && stake > bankrollCapRaw) {
            console.warn(`[sdk-helpers] Bankroll cap prevents fill ${fillId} for ${follower}`);
            continue;
          }
          // Auto-roll guardrail checks
          if (activeRule.autoRoll) {
            // Stop-loss: halt if consecutive losses >= threshold
            if (
              activeRule.consecutiveLosses >=
              activeRule.guardrails.stopLossRounds
            ) {
              console.warn(
                `[sdk-helpers] Stop-loss (${activeRule.guardrails.stopLossRounds} consecutive losses) hit for ${follower}`,
              );
              if (!dryRun) {
                await sessionKeysKV.put(nonceKey, "1", {
                  expirationTtl: FILL_NONCE_TTL_SECONDS,
                });
              }
              if (!dryRun) {
                await sessionKeysKV.put(
                  `follower:${follower}:${whale}`,
                  serializeRule(activeRule),
                  { expirationTtl: FILL_NONCE_TTL_SECONDS },
                );
              }
              processed.push(fillId);
              continue;
            }

            // Daily cap + max rounds via canOpenPosition
            // Check if we already have an open position
            const existingRollRecord = await sessionKeysKV.get(activeRollKey);
            if (existingRollRecord) {
              const existingRollJson = await sessionKeysKV.get(existingRollRecord);
              if (!existingRollJson) {
                await sessionKeysKV.delete(activeRollKey);
              } else {
                const existing = JSON.parse(existingRollJson) as RollState;
              if (existing.phase === "OPEN" || existing.phase === "WINNER") {
                if (!dryRun) {
                  await sessionKeysKV.put(nonceKey, "1", {
                    expirationTtl: FILL_NONCE_TTL_SECONDS,
                  });
                }
                processed.push(fillId);
                continue;
              }
              }
            }

          }

          if (!canOpenPosition(activeRule, stake)) {
            console.warn(`[sdk-helpers] Guardrails prevent new position for ${follower}, skipping fill ${fillId}`);
            continue;
          }

          // Place the order
          const quantity = BigInt(fill.quantity);

          if (!dryRun) {
            const sessionTrader = sdk.client.createTrader({
              privateKey: rule.sessionKey as `0x${string}`,
            });

            await sessionTrader.placeOrder({
              pool: pool as `0x${string}`,
              side: copySide,
              price: BigInt(fill.fillPrice),
              quantity,
              orderType: ORDER_TYPE.MARKET,
            });

            await sessionKeysKV.put(nonceKey, "1", {
              expirationTtl: FILL_NONCE_TTL_SECONDS,
            });
          }

          // Consume guardrail budget only after the order succeeds (or in a
          // dry run, after recording the order that would have succeeded).
          activeRule.dailyVolume += stake;
          activeRule.roundsToday += 1;

          // Save roll state for auto-roll followers
          if (activeRule.autoRoll && !dryRun) {
            const sourceInterval = sourceMarket?.intervalSec ? Number(sourceMarket.intervalSec) : 0;
            if (!sourceMarket?.asset || sourceInterval <= 0) {
              throw new Error(`Auto-roll market metadata unavailable for ${fill.market}`);
            }
            const rollState: RollState = {
              walletAddress: follower,
              whaleAddress: whale,
              fillId: fillId,
              marketId: fill.market,
              pool: pool,
              phase: "OPEN" as RollPhase,
              entryPrice: Number(fill.fillPrice) / 10 ** quoteDecimals,
              entryTime: Math.floor(Date.now() / 1000),
              stake: fill.quoteQuantity,
              whaleSide: copySide,
              cashOutTarget: activeRule.guardrails.cashOutTarget,
              stopLossRounds: activeRule.guardrails.stopLossRounds,
              maxRounds: activeRule.guardrails.maxRounds,
              dailyCap: activeRule.guardrails.dailyCap.toString(),
              consecutiveLosses: activeRule.consecutiveLosses,
              roundsToday: activeRule.roundsToday,
              dailyVolume: activeRule.dailyVolume.toString(),
              rolledFromFillId: null,
              initialStake: fill.quoteQuantity,
              realizedProceeds: "0",
              asset: sourceMarket.asset,
              intervalSec: sourceInterval,
            };

            const rollRecordKey = `roll:${follower}:${whale}:${fillId}`;
            await sessionKeysKV.put(rollRecordKey, JSON.stringify(rollState), {
              expirationTtl: FILL_NONCE_TTL_SECONDS,
            });
            await sessionKeysKV.put(activeRollKey, rollRecordKey, {
              expirationTtl: FILL_NONCE_TTL_SECONDS,
            });

            // Persist updated rule (with counters + daily volume)
            await sessionKeysKV.put(
              `follower:${follower}:${whale}`,
              serializeRule(activeRule),
              { expirationTtl: FILL_NONCE_TTL_SECONDS },
            );
          }

          if (!dryRun && !activeRule.autoRoll) {
            await sessionKeysKV.put(`follower:${follower}:${whale}`, serializeRule(activeRule), {
              expirationTtl: FILL_NONCE_TTL_SECONDS,
            });
          }

          processed.push(fillId);
          console.log(
            `[sdk-helpers] Routed copy order for ${follower} on ${fill.market}`,
          );
        } catch (err) {
          const msg = `${follower}: ${err instanceof Error ? err.message : String(err)}`;
          errors.push(msg);
          console.error(
            `[sdk-helpers] Failed to route copy order for ${follower}:`,
            err,
          );
        }
      }
    } catch (err) {
      errors.push(
        `${follower}: ${err instanceof Error ? err.message : String(err)}`,
      );
      console.error(
        `[sdk-helpers] Failed to process follower ${follower}:`,
        err,
      );
    }
  }

  // Process settled positions for auto-rolling followers
  if (!dryRun) {
    for (const { follower, whale, rule } of targetPairs) {
      if (!rule.autoRoll) continue;

      const result = await processSettledRolls(
        sdk,
        sessionKeysKV,
        follower,
        whale,
        rule,
      );
      rolled.push(...result.rolled);
      errors.push(...result.errors);
    }
  }

  return { processed, errors, rolled };
}
