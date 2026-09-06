import { describe, it, expect } from "vitest";
import { computeHonestBinaryPnl, marketWonFromSide, type ComputePerMarketPnLOptions } from "./dreamdex";
import type { BinaryPnlFill, OutcomeBalances } from "@somnia-chain/markets-sdk";

const marketResolvedYes = {
  quoteDecimals: 6,
  lastPrice: "500000",
  winningOutcome: 0 as const,
  voided: false,
};

const emptyBalances: OutcomeBalances = {
  yes: "0",
  no: "0",
};

describe("computeHonestBinaryPnl", () => {
  it("reconstructs positive settlement PnL after redeem (balances=0)", () => {
    // Bought 100 YES @ 0.40 → cost 40; YES wins → settlement 100; PnL = +60
    const fills: BinaryPnlFill[] = [
      {
        outcomeIndex: 0,
        isBuy: true,
        quantity: "100000000",
        price: "400000",
      },
    ];
    const pnl = computeHonestBinaryPnl(fills, emptyBalances, marketResolvedYes);
    expect(pnl.total).toBeCloseTo(60, 5);
    expect(pnl.total).toBeGreaterThan(0);
  });

  it("reconstructs loss when held losing side then redeemed", () => {
    const fills: BinaryPnlFill[] = [
      {
        outcomeIndex: 0,
        isBuy: true,
        quantity: "100000000",
        price: "400000",
      },
    ];
    const pnl = computeHonestBinaryPnl(fills, emptyBalances, {
      ...marketResolvedYes,
      winningOutcome: 1,
    });
    expect(pnl.total).toBeCloseTo(-40, 5);
  });

  it("does not invent PnL when still holding (SDK marks unrealized)", () => {
    const fills: BinaryPnlFill[] = [
      {
        outcomeIndex: 0,
        isBuy: true,
        quantity: "100000000",
        price: "400000",
      },
    ];
    const holding: OutcomeBalances = { yes: "100000000", no: "0" };
    const pnl = computeHonestBinaryPnl(fills, holding, marketResolvedYes);
    expect(pnl.total).toBeCloseTo(60, 5);
  });

  it("keeps sell-realized PnL when inventory was fully closed before resolve", () => {
    // Indexer/SDK order is newest-first; computeBinaryPnl reverses to oldest-first.
    const fills: BinaryPnlFill[] = [
      { outcomeIndex: 0, isBuy: false, quantity: "100000000", price: "500000" },
      { outcomeIndex: 0, isBuy: true, quantity: "100000000", price: "400000" },
    ];
    const pnl = computeHonestBinaryPnl(fills, emptyBalances, marketResolvedYes);
    expect(pnl.total).toBeCloseTo(10, 5);
  });
});

describe("marketWonFromSide", () => {
  it("YES holder wins when winningOutcome=0", () => {
    expect(marketWonFromSide({ winningOutcome: 0, voided: false }, true)).toBe(true);
    expect(marketWonFromSide({ winningOutcome: 0, voided: false }, false)).toBe(false);
  });

  it("returns undefined for voided/unresolved", () => {
    expect(marketWonFromSide({ winningOutcome: null, voided: false }, true)).toBeUndefined();
    expect(marketWonFromSide({ winningOutcome: 0, voided: true }, true)).toBeUndefined();
  });
});

describe("ComputePerMarketPnLOptions", () => {

  it("documents preferSettledFills as optional boolean", () => {

    const opts: ComputePerMarketPnLOptions = { preferSettledFills: true };

    expect(opts.preferSettledFills).toBe(true);

  });

});
