import { describe, expect, it } from "vitest";
import { assertDailyLimit } from "./strategy.js";

describe("market bot guardrails", () => {
  it("allows a notional within the daily cap", () => {
    expect(() => assertDailyLimit(2n, 3n, 5n)).not.toThrow();
  });

  it("blocks an order that would exceed the daily cap", () => {
    expect(() => assertDailyLimit(3n, 3n, 5n)).toThrow(
      "Configured daily notional limit would be exceeded",
    );
  });
});
