import { SomniaMarkets } from "@somnia-chain/markets-sdk";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
import { privateKeyToAccount } from "viem/accounts";
import { parseUnits } from "viem";
import { loadConfig } from "./config.js";
import { discoverMarket } from "./discovery.js";
import { NoMarketAvailableError } from "./discovery.js";
import { waitForIndexedFill } from "./execution.js";
import { loadState, saveState } from "./state.js";
import { assertDailyLimit, buildOrderPlan } from "./strategy.js";
import { logEvent } from "./telemetry.js";
import { sleep } from "./util.js";

async function runOnce(): Promise<void> {
  const config = loadConfig();
  const readSdk = new SomniaMarkets({
    chain: somniaShannon,
    indexerUrl: config.restUrl,
    wsRpcUrl: config.wsUrl,
  });

  if (config.checkOnly) {
    const candidate = await discoverMarket(readSdk, config);
    logEvent("market_selected", {
      marketId: candidate.market.marketId,
      pool: candidate.onchain.pool,
      marketAddress: candidate.onchain.marketAddress,
      question: candidate.market.question,
      expiry: candidate.market.expiry,
      side: config.strategySide,
      bestAsk: candidate.ask.price.toString(),
      bestAskQuantity: candidate.ask.quantity.toString(),
      spreadBps: candidate.spreadBps,
    });
    return;
  }

  if (!config.privateKey) throw new Error("PRIVATE_KEY is required for signing mode");
  const account = privateKeyToAccount(config.privateKey);
  const state = await loadState(config.stateFile);

  if (state.inFlight) {
    throw new Error(`An execution is already in flight for ${state.inFlight.marketId}; inspect ${config.stateFile} before retrying`);
  }
  const candidate = await discoverMarket(
    readSdk,
    config,
    Math.floor(Date.now() / 1000),
    new Set(state.executedMarketIds),
  );
  if (state.executedMarketIds.includes(candidate.market.marketId)) {
    throw new Error(`Market ${candidate.market.marketId} was already executed; refusing a duplicate one-shot order`);
  }

  const plan = buildOrderPlan(candidate, config);
  const maxDailyRaw = parseUnits(config.maxDailyUsdc, candidate.market.quoteDecimals);
  assertDailyLimit(BigInt(state.dailyVolumeRaw), plan.notionalRaw, maxDailyRaw);

  const live = await readSdk.client.getMarketOnchain(candidate.market.marketId);
  if (live.status !== 1 || live.isResolved || live.isVoided || live.expiry <= BigInt(Math.floor(Date.now() / 1000) + config.minExpirySeconds)) {
    throw new Error("Selected market is no longer safely tradable");
  }
  const balance = await readSdk.client.getErc20Balance(live.collateral, account.address);
  if (balance < plan.notionalRaw) throw new Error("Bot wallet collateral is below the planned order notional");

  state.inFlight = {
    marketId: candidate.market.marketId,
    pool: live.pool,
    startedAt: Date.now(),
  };
  await saveState(config.stateFile, state);

  try {
    const exchange = new SomniaMarkets({
      chain: somniaShannon,
      indexerUrl: config.restUrl,
      wsRpcUrl: config.wsUrl,
      privateKey: config.privateKey,
    });
    await exchange.loadMarkets();
    const tradable = exchange.market(candidate.market.marketId);
    const outcome = config.strategySide === "BUY_YES" ? "YES" : "NO";
    const order = await exchange.createOrder(
      `${tradable.symbol}#${outcome}`,
      "limit",
      "buy",
      plan.amount,
      plan.price,
      { timeInForce: "IOC" },
    );
    if (!order.txHash) throw new Error("SDK returned no transaction hash");
    state.inFlight.txHash = order.txHash;
    await saveState(config.stateFile, state);
    logEvent("order_submitted", {
      account: account.address,
      marketId: candidate.market.marketId,
      pool: live.pool,
      side: plan.side,
      amount: plan.amount,
      price: plan.price,
      txHash: order.txHash,
      status: order.status,
    });

    if (order.filled <= 0) {
      state.inFlight = null;
      await saveState(config.stateFile, state);
      logEvent("order_not_filled", { txHash: order.txHash, status: order.status });
      return;
    }

    const indexed = await waitForIndexedFill(
      readSdk,
      account.address,
      live.pool,
      order.txHash,
      config.fillTimeoutMs,
      config.pollIntervalMs,
    );
    state.dailyVolumeRaw = (BigInt(state.dailyVolumeRaw) + BigInt(indexed.fill.quoteQuantity)).toString();
    state.executions = [...state.executions.slice(-99), indexed.fill.txHash];
    state.executedMarketIds = [...state.executedMarketIds, candidate.market.marketId];
    state.inFlight = null;
    await saveState(config.stateFile, state);
    logEvent("fill_indexed", {
      account: account.address,
      marketId: candidate.market.marketId,
      pool: live.pool,
      fillId: indexed.fill.id,
      txHash: indexed.fill.txHash,
      quoteQuantity: indexed.fill.quoteQuantity,
    });
  } catch (error) {
    logEvent("execution_failed", {
      marketId: candidate.market.marketId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function run(): Promise<void> {
  const config = loadConfig();
  if (!config.continuous) {
    await runOnce();
    return;
  }

  logEvent("continuous_mode_started", { intervalMs: config.pollIntervalMs });
  while (true) {
    try {
      await runOnce();
    } catch (error) {
      logEvent("continuous_cycle_failed", {
        retrying: true,
        error: error instanceof Error ? error.message : String(error),
        unavailableMarket: error instanceof NoMarketAvailableError,
      });
      if (error instanceof Error && error.message.includes("execution is already in flight")) {
        throw error;
      }
    }
    await sleep(config.pollIntervalMs);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run().catch((error: unknown) => {
    logEvent("bot_failed", { error: error instanceof Error ? error.message : String(error) });
    process.exitCode = 1;
  });
}

export { run, runOnce };
