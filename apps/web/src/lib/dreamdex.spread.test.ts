import { describe, it, expect } from "vitest";
import { spreadBpsFromRawBookPrices } from "./dreamdex";

describe("spreadBpsFromRawBookPrices", () => {
  it("scales raw book ints by quoteDecimals (repro: 210000000 → 210 bps)", () => {
    // Live E2E: raw ask-bid = 21000 with 6 decimals → 0.021 human → 210 bps
    const result = spreadBpsFromRawBookPrices("500000", "521000", 6);
    expect(result).not.toBeNull();
    expect(result!.spreadBps).toBeCloseTo(210, 6);
    expect(result!.midHuman).toBeCloseTo(0.5105, 6);
  });

  it("returns tight spread under the 100 bps gate for a 1-tick book", () => {
    // 0.500000 vs 0.500100 → 1 bps
    const result = spreadBpsFromRawBookPrices("500000", "500100", 6);
    expect(result!.spreadBps).toBeCloseTo(1, 6);
  });

  it("refuses inverted or non-finite books", () => {
    expect(spreadBpsFromRawBookPrices("521000", "500000", 6)).toBeNull();
    expect(spreadBpsFromRawBookPrices("NaN", "500000", 6)).toBeNull();
  });

  it("refuses missing quoteDecimals instead of emitting raw*10000", () => {
    expect(spreadBpsFromRawBookPrices("500000", "521000", -1)).toBeNull();
    const badDecimals = 6.5 as number;
    expect(spreadBpsFromRawBookPrices("500000", "521000", badDecimals)).toBeNull();
  });
});
