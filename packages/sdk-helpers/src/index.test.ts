import { describe, expect, it } from "vitest";
import { routeCopyOrders, type AutoCopyRule } from "./index";

class FakeKV {
  private readonly values = new Map<string, string>();
  readonly writes: string[] = [];

  async get(key: string) { return this.values.get(key) ?? null; }
  async put(key: string, value: string) {
    this.values.set(key, value);
    this.writes.push(key);
  }
  async delete(key: string) { this.values.delete(key); }
  async list(options: { prefix?: string } = {}) {
    const prefix = options.prefix ?? "";
    return {
      keys: [...this.values.keys()].filter((key) => key.startsWith(prefix)).map((name) => ({ name })),
      list_complete: true,
      cursor: "",
    };
  }
}

function makeRule(): AutoCopyRule {
  return {
    walletAddress: "0x1111111111111111111111111111111111111111",
    whaleAddress: "0x2222222222222222222222222222222222222222",
    sessionKey: "0x3333333333333333333333333333333333333333333333333333333333333333",
    bankrollCap: 100,
    autoRoll: true,
    guardrails: {
      cashOutTarget: 200,
      stopLossRounds: 3,
      maxRounds: 10,
      dailyCap: 1_000_000_000n,
    },
    dailyVolume: 100n,
    dayKey: new Date().toISOString().slice(0, 10),
    consecutiveLosses: 0,
    roundsToday: 1,
    lastFillId: null,
  };
}

function makeSdk() {
  let placements = 0;
  let redemptions = 0;
  let statusReads = 0;
  let collateralBalance = 1000n;
  const sdk = {
    client: {
      async getUserFills() {
        return [{
          id: "fill-1",
          txHash: "0xtx-1",
          market: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          pool: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          fillPrice: "600000",
          quantity: "100",
          quoteQuantity: "100000000",
          takerSide: "BUY_YES",
        }];
      },
      async getBinaryMarket(marketId: string) {
        if (marketId.includes("cccccccc")) {
          return {
            id: marketId,
            poolAddress: "0xdddddddddddddddddddddddddddddddddddddddd",
            asset: "BTC",
            intervalSec: 3600,
            quoteDecimals: 6,
            lastPrice: "600000",
          };
        }
        return { id: marketId, asset: "BTC", intervalSec: 3600, quoteDecimals: 6 };
      },
      async getMarketOnchain(marketId: string) {
        if (marketId.includes("aaaaaaaa")) {
          statusReads += 1;
          if (statusReads === 1) return { status: 1, isResolved: false, isVoided: false, winningOutcome: 0, expiry: BigInt(Math.floor(Date.now() / 1000) + 3600) };
          return { status: 4, isResolved: true, isVoided: false, winningOutcome: 0, expiry: BigInt(Math.floor(Date.now() / 1000) - 1) };
        }
        return { status: 1, isResolved: false, isVoided: false, winningOutcome: 0 };
      },
      async getClaimable() {
        return [{
          marketId: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          outcomeIdx: 0,
          amount: 150n,
          estPayout: 150n,
        }];
      },
      async getErc20Balance() {
        return collateralBalance;
      },
      async listLiveBinaryMarkets() {
        return [{
          id: "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
          marketId: "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
          poolAddress: "0xdddddddddddddddddddddddddddddddddddddddd",
          asset: "BTC",
          intervalSec: 3600,
          expiry: String(Math.floor(Date.now() / 1000) + 3600),
          status: "Trading",
          lastPrice: "600000",
        }];
      },
      createTrader() {
        return {
          async placeOrder() { placements += 1; },
          async redeemMany() { redemptions += 1; collateralBalance += 150n; },
        };
      },
    },
  };
  return { sdk, counts: () => ({ placements, redemptions }) };
}

describe("routeCopyOrders", () => {
  it("redeems a winner and rolls once while nonce-guarding retries", async () => {
    const kv = new FakeKV();
    const rule = makeRule();
    await kv.put(`follower:${rule.walletAddress}:${rule.whaleAddress}`, JSON.stringify({
      ...rule,
      dailyVolume: rule.dailyVolume.toString(),
      guardrails: { ...rule.guardrails, dailyCap: rule.guardrails.dailyCap.toString() },
    }));
    const { sdk, counts } = makeSdk();

    const first = await routeCopyOrders(sdk as never, kv as never, { followerAddresses: [], dryRun: false });
    const second = await routeCopyOrders(sdk as never, kv as never, { followerAddresses: [], dryRun: false });

    expect(first.errors).toEqual([]);
    expect(first.rolled).toHaveLength(1);
    expect(second.processed).toEqual([]);
    expect(counts()).toEqual({ placements: 2, redemptions: 1 });
  });

  it("does not consume guardrail budget when a fill is blocked", async () => {
    const kv = new FakeKV();
    const rule = {
      ...makeRule(),
      roundsToday: 10,
      guardrails: { ...makeRule().guardrails, maxRounds: 10 },
    };
    const followerKey = `follower:${rule.walletAddress}:${rule.whaleAddress}`;
    await kv.put(followerKey, JSON.stringify({
      ...rule,
      dailyVolume: rule.dailyVolume.toString(),
      guardrails: { ...rule.guardrails, dailyCap: rule.guardrails.dailyCap.toString() },
    }));
    const writesBefore = [...kv.writes];
    const { sdk, counts } = makeSdk();

    const result = await routeCopyOrders(sdk as never, kv as never, {
      followerAddresses: [],
      dryRun: false,
    });

    expect(result.processed).toEqual([]);
    expect(counts().placements).toBe(0);
    expect(kv.writes).toEqual(writesBefore);
    expect(JSON.parse((await kv.get(followerKey)) as string).roundsToday).toBe(10);
  });

  it("does not persist stop-loss handling during a dry run", async () => {
    const kv = new FakeKV();
    const base = makeRule();
    const rule = {
      ...base,
      consecutiveLosses: base.guardrails.stopLossRounds,
    };
    await kv.put(`follower:${rule.walletAddress}:${rule.whaleAddress}`, JSON.stringify({
      ...rule,
      dailyVolume: rule.dailyVolume.toString(),
      guardrails: { ...rule.guardrails, dailyCap: rule.guardrails.dailyCap.toString() },
    }));
    const writesBefore = [...kv.writes];
    const { sdk } = makeSdk();

    const result = await routeCopyOrders(sdk as never, kv as never, {
      followerAddresses: [],
      dryRun: true,
    });

    expect(result.processed).toHaveLength(1);
    expect(kv.writes).toEqual(writesBefore);
  });

  it("handles empty whale fills gracefully (no activity tick)", async () => {
    const kv = new FakeKV();
    const rule = makeRule();
    await kv.put(`follower:${rule.walletAddress}:${rule.whaleAddress}`, JSON.stringify({
      ...rule,
      dailyVolume: rule.dailyVolume.toString(),
      guardrails: { ...rule.guardrails, dailyCap: rule.guardrails.dailyCap.toString() },
    }));
    const emptySdk = {
      client: {
        async getUserFills() { return []; },
        async getBinaryMarket() { return null; },
        async getMarketOnchain() { return null; },
        async getClaimable() { return []; },
        async getErc20Balance() { return 0n; },
        async listLiveBinaryMarkets() { return []; },
        createTrader() { return { async placeOrder() {}, async redeemMany() {} }; },
      },
    };
    const { counts } = makeSdk();

    const result = await routeCopyOrders(emptySdk as never, kv as never, {
      followerAddresses: [],
      dryRun: false,
    });

    expect(result.processed).toEqual([]);
    expect(result.errors).toEqual([]);
    expect(result.rolled).toEqual([]);
    expect(counts()).toEqual({ placements: 0, redemptions: 0 });
  });

  it("reports errors when SDK throws during whale fill fetch", async () => {
    const kv = new FakeKV();
    const rule = makeRule();
    await kv.put(`follower:${rule.walletAddress}:${rule.whaleAddress}`, JSON.stringify({
      ...rule,
      dailyVolume: rule.dailyVolume.toString(),
      guardrails: { ...rule.guardrails, dailyCap: rule.guardrails.dailyCap.toString() },
    }));
    const failingSdk = {
      client: {
        async getUserFills() { throw new Error("RPC timeout"); },
        async getBinaryMarket() { return null; },
        async getMarketOnchain() { return null; },
        async getClaimable() { return []; },
        async getErc20Balance() { return 0n; },
        async listLiveBinaryMarkets() { return []; },
        createTrader() { return { async placeOrder() {}, async redeemMany() {} }; },
      },
    };

    const result = await routeCopyOrders(failingSdk as never, kv as never, {
      followerAddresses: [],
      dryRun: false,
    });

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("RPC timeout");
  });

  it("filters to a specific follower address when followerAddresses is set", async () => {
    const kv = new FakeKV();
    const rule = makeRule();
    await kv.put(`follower:${rule.walletAddress}:${rule.whaleAddress}`, JSON.stringify({
      ...rule,
      dailyVolume: rule.dailyVolume.toString(),
      guardrails: { ...rule.guardrails, dailyCap: rule.guardrails.dailyCap.toString() },
    }));
    const { sdk, counts } = makeSdk();

    const result = await routeCopyOrders(sdk as never, kv as never, {
      followerAddresses: ["0x1111111111111111111111111111111111111111"],
      dryRun: false,
    });

    expect(result.processed).toHaveLength(1);
    expect(result.errors).toEqual([]);
    expect(counts().placements).toBe(2);
  });

  it("skips followers not in the followerAddresses filter", async () => {
    const kv = new FakeKV();
    const rule = makeRule();
    await kv.put(`follower:${rule.walletAddress}:${rule.whaleAddress}`, JSON.stringify({
      ...rule,
      dailyVolume: rule.dailyVolume.toString(),
      guardrails: { ...rule.guardrails, dailyCap: rule.guardrails.dailyCap.toString() },
    }));
    const { sdk, counts } = makeSdk();

    const result = await routeCopyOrders(sdk as never, kv as never, {
      followerAddresses: ["0x9999999999999999999999999999999999999999"],
      dryRun: false,
    });

    expect(result.processed).toEqual([]);
    expect(counts()).toEqual({ placements: 0, redemptions: 0 });
  });
});
