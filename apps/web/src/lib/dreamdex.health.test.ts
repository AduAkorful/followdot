import { describe, it, expect } from "vitest";
import {
  binaryStatusToOnchainInt,
  isCopyableMarketStatus,
} from "./dreamdex";

describe("binaryStatusToOnchainInt", () => {
  it("maps every BinaryMarketStatus onto on-chain ints", () => {
    expect(binaryStatusToOnchainInt("Listed")).toBe(0);
    expect(binaryStatusToOnchainInt("Trading")).toBe(1);
    expect(binaryStatusToOnchainInt("Locked")).toBe(2);
    expect(binaryStatusToOnchainInt("Settling")).toBe(3);
    expect(binaryStatusToOnchainInt("Resolved")).toBe(4);
    expect(binaryStatusToOnchainInt("Finalized")).toBe(4);
    expect(binaryStatusToOnchainInt("Voided")).toBe(5);
  });

  it("returns null for unknown or empty statuses", () => {
    expect(binaryStatusToOnchainInt("Nope")).toBeNull();
    expect(binaryStatusToOnchainInt("")).toBeNull();
    expect(binaryStatusToOnchainInt(null)).toBeNull();
    expect(binaryStatusToOnchainInt(undefined)).toBeNull();
  });
});

describe("isCopyableMarketStatus", () => {
  it("allows live lifecycle states without a winner", () => {
    expect(isCopyableMarketStatus("Trading", null, false)).toBe(true);
    expect(isCopyableMarketStatus("Listed", null, false)).toBe(true);
    expect(isCopyableMarketStatus("Locked", null, false)).toBe(true);
  });

  it("blocks settled, voided, finalized, or missing status", () => {
    expect(isCopyableMarketStatus("Trading", 0, false)).toBe(false);
    expect(isCopyableMarketStatus("Finalized", null, false)).toBe(false);
    expect(isCopyableMarketStatus("Settling", null, false)).toBe(false);
    expect(isCopyableMarketStatus("Resolved", 1, false)).toBe(false);
    expect(isCopyableMarketStatus("Trading", null, true)).toBe(false);
    expect(isCopyableMarketStatus(null, null, false)).toBe(false);
    expect(isCopyableMarketStatus("", null, false)).toBe(false);
  });
});
