import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const baseEnv = {
  DREAMDEX_REST_URL: "https://dev.smk.somnia.host/v1/graphql",
  DREAMDEX_WS_URL: "wss://api.infra.testnet.somnia.network/ws",
  PRIVATE_KEY: "0x1111111111111111111111111111111111111111111111111111111111111111",
  MAX_ORDER_USDC: "1",
  MAX_DAILY_USDC: "5",
  MIN_EXPIRY_SECONDS: "120",
  STRATEGY_SIDE: "BUY_YES",
  BOT_STATE_FILE: "/tmp/followdot-market-bot-test-state.json",
  MAX_SPREAD_BPS: "1000",
  POLL_INTERVAL_MS: "2000",
  FILL_TIMEOUT_MS: "30000",
};

describe("market bot configuration", () => {
  it("loads validated runtime values", () => {
    const config = loadConfig(baseEnv);
    expect(config.strategySide).toBe("BUY_YES");
    expect(config.minExpirySeconds).toBe(120);
    expect(config.checkOnly).toBe(false);
  });

  it("fails closed when the signer is absent", () => {
    const env = { ...baseEnv };
    delete env.PRIVATE_KEY;
    expect(() => loadConfig(env)).toThrow("PRIVATE_KEY is required");
  });

  it("allows read-only discovery without a signer", () => {
    const env = { ...baseEnv, CHECK_ONLY: "true" };
    delete env.PRIVATE_KEY;
    expect(loadConfig(env).checkOnly).toBe(true);
    expect(loadConfig(env).privateKey).toBeUndefined();
  });

  it("rejects unsupported order sides", () => {
    expect(() => loadConfig({ ...baseEnv, STRATEGY_SIDE: "SELL_YES" })).toThrow(
      "STRATEGY_SIDE must be one of BUY_YES, BUY_NO",
    );
  });

  it("does not silently enable continuous trading", () => {
    expect(() => loadConfig({ ...baseEnv, RUN_ONCE: "false" })).toThrow(
      "Set exactly one of RUN_ONCE=true or CONTINUOUS=true",
    );
  });

  it("enables continuous mode only with an explicit mode pair", () => {
    const config = loadConfig({ ...baseEnv, RUN_ONCE: "false", CONTINUOUS: "true" });
    expect(config.continuous).toBe(true);
  });

  it("does not run a continuous loop in read-only mode", () => {
    expect(() => loadConfig({ ...baseEnv, RUN_ONCE: "false", CONTINUOUS: "true", CHECK_ONLY: "true" })).toThrow(
      "CHECK_ONLY cannot be combined with CONTINUOUS",
    );
  });
});
