import { describe, it, expect } from "vitest";
import {
  transitionRollState,
  didWhaleSideWin,
  shouldHaltAfterWin,
  canOpenPosition,
  maybeRollDayKey,
  findNextWindowMarket,
  type RollState,
  type AutoCopyRule,
} from "./roll-state";

function makeState(overrides: Partial<RollState> = {}): RollState {
  return {
    walletAddress: "0x1234567890123456789012345678901234567890",
    whaleAddress: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
    fillId: "0xtx1:0",
    marketId: "0xmarket1",
    pool: "0xpool1",
    phase: "OPEN",
    entryPrice: 0.6,
    entryTime: 1000,
    stake: "1000000",
    whaleSide: "BUY_YES",
    cashOutTarget: 150,
    stopLossRounds: 3,
    maxRounds: 10,
    dailyCap: "100000000",
    consecutiveLosses: 0,
    roundsToday: 1,
    dailyVolume: "1000000",
    rolledFromFillId: null,
    ...overrides,
  };
}

function makeRule(overrides: Partial<AutoCopyRule> = {}): AutoCopyRule {
  return {
    walletAddress: "0x1234567890123456789012345678901234567890",
    whaleAddress: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
    sessionKey: "0xsessionkey",
    bankrollCap: 100,
    autoRoll: false,
    guardrails: {
      cashOutTarget: 150,
      stopLossRounds: 3,
      maxRounds: 10,
      dailyCap: 100_000_000n,
    },
    dailyVolume: 1_000_000n,
    dayKey: new Date().toISOString().slice(0, 10),
    consecutiveLosses: 0,
    roundsToday: 1,
    lastFillId: null,
    ...overrides,
  };
}

// ─── didWhaleSideWin ─────────────────────────────────────────────────

describe("didWhaleSideWin", () => {
  it("BUY_YES wins when YES wins (outcome=0)", () => {
    expect(didWhaleSideWin("BUY_YES", 0)).toBe(true);
  });

  it("BUY_YES loses when NO wins (outcome=1)", () => {
    expect(didWhaleSideWin("BUY_YES", 1)).toBe(false);
  });

  it("SELL_NO wins when YES wins (outcome=0)", () => {
    expect(didWhaleSideWin("SELL_NO", 0)).toBe(true);
  });

  it("SELL_NO loses when NO wins (outcome=1)", () => {
    expect(didWhaleSideWin("SELL_NO", 1)).toBe(false);
  });

  it("BUY_NO wins when NO wins (outcome=1)", () => {
    expect(didWhaleSideWin("BUY_NO", 1)).toBe(true);
  });

  it("BUY_NO loses when YES wins (outcome=0)", () => {
    expect(didWhaleSideWin("BUY_NO", 0)).toBe(false);
  });

  it("SELL_YES wins when NO wins (outcome=1)", () => {
    expect(didWhaleSideWin("SELL_YES", 1)).toBe(true);
  });

  it("SELL_YES loses when YES wins (outcome=0)", () => {
    expect(didWhaleSideWin("SELL_YES", 0)).toBe(false);
  });
});

// ─── transitionRollState ─────────────────────────────────────────────

describe("transitionRollState", () => {
  it("OPEN → WINNER when whale side wins", () => {
    const state = makeState({ phase: "OPEN", whaleSide: "BUY_YES" });
    const settled = { marketId: "0xmarket1", winningOutcome: 0, voided: false, resolved: true };
    const next = transitionRollState(state, settled);
    expect(next.phase).toBe("WINNER");
    expect(next.consecutiveLosses).toBe(0); // unchanged on win
  });

  it("OPEN → LOSER when whale side loses, increments consecutiveLosses", () => {
    const state = makeState({ phase: "OPEN", whaleSide: "BUY_YES", consecutiveLosses: 0 });
    const settled = { marketId: "0xmarket1", winningOutcome: 1, voided: false, resolved: true };
    const next = transitionRollState(state, settled);
    expect(next.phase).toBe("LOSER");
    expect(next.consecutiveLosses).toBe(1);
  });

  it("OPEN → VOID when market is voided", () => {
    const state = makeState({ phase: "OPEN" });
    const settled = { marketId: "0xmarket1", winningOutcome: null, voided: true, resolved: true };
    const next = transitionRollState(state, settled);
    expect(next.phase).toBe("VOID");
  });

  it("LOSER → HALTED when consecutiveLosses >= stopLossRounds", () => {
    const state = makeState({ phase: "LOSER", consecutiveLosses: 3, stopLossRounds: 3 });
    const settled = { marketId: "0xmarket1", winningOutcome: 1, voided: false, resolved: true };
    const next = transitionRollState(state, settled);
    expect(next.phase).toBe("HALTED");
  });

  it("LOSER stays LOSER when consecutiveLosses < stopLossRounds", () => {
    const state = makeState({ phase: "LOSER", consecutiveLosses: 1, stopLossRounds: 3 });
    const settled = { marketId: "0xmarket1", winningOutcome: 1, voided: false, resolved: true };
    const next = transitionRollState(state, settled);
    expect(next.phase).toBe("LOSER");
  });

  it("WINNER stays WINNER (no halt) when rounds < maxRounds", () => {
    const state = makeState({ phase: "WINNER", roundsToday: 1, maxRounds: 10 });
    const settled = { marketId: "0xmarket1", winningOutcome: 0, voided: false, resolved: true };
    const next = transitionRollState(state, settled);
    expect(next.phase).not.toBe("HALTED");
  });

  it("WINNER → HALTED when roundsToday >= maxRounds", () => {
    const state = makeState({ phase: "WINNER", roundsToday: 10, maxRounds: 10 });
    const settled = { marketId: "0xmarket1", winningOutcome: 0, voided: false, resolved: true };
    const next = transitionRollState(state, settled);
    expect(next.phase).toBe("HALTED");
  });

  it("OPEN → OPEN when market not yet settled", () => {
    const state = makeState({ phase: "OPEN" });
    const settled = { marketId: "0xmarket1", winningOutcome: null, voided: false, resolved: false };
    const next = transitionRollState(state, settled);
    expect(next.phase).toBe("OPEN");
  });
});

// ─── shouldHaltAfterWin ───────────────────────────────────────────────

describe("shouldHaltAfterWin", () => {
  it("returns true when roundsToday >= maxRounds", () => {
    const state = makeState({ roundsToday: 10, maxRounds: 10 });
    expect(shouldHaltAfterWin(state)).toBe(true);
  });

  it("returns false when roundsToday < maxRounds", () => {
    const state = makeState({ roundsToday: 3, maxRounds: 10 });
    expect(shouldHaltAfterWin(state)).toBe(false);
  });

  it("halts when cumulative redeemed proceeds reach the cash-out target", () => {
    const state = makeState({
      initialStake: "100",
      realizedProceeds: "150",
      cashOutTarget: 150,
      roundsToday: 2,
      maxRounds: 10,
    });
    expect(shouldHaltAfterWin(state)).toBe(true);
  });
});

// ─── canOpenPosition ──────────────────────────────────────────────────

describe("canOpenPosition", () => {
  it("returns true when under both limits", () => {
    const rule = makeRule({ roundsToday: 5, dailyVolume: 10_000_000n });
    expect(canOpenPosition(rule, 1_000_000n)).toBe(true);
  });

  it("returns false when roundsToday >= maxRounds", () => {
    const rule = makeRule({ roundsToday: 10 });
    expect(canOpenPosition(rule, 1_000_000n)).toBe(false);
  });

  it("returns false when dailyVolume + stake exceeds dailyCap", () => {
    const rule = makeRule({ dailyVolume: 99_000_000n, guardrails: { ...makeRule().guardrails, dailyCap: 100_000_000n } });
    expect(canOpenPosition(rule, 2_000_000n)).toBe(false);
  });

  it("returns true when dailyVolume + stake equals dailyCap exactly", () => {
    const rule = makeRule({ dailyVolume: 99_000_000n, guardrails: { ...makeRule().guardrails, dailyCap: 100_000_000n } });
    expect(canOpenPosition(rule, 1_000_000n)).toBe(true);
  });
});

// ─── maybeRollDayKey ──────────────────────────────────────────────────

describe("maybeRollDayKey", () => {
  const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10);

  it("resets daily counters when day key changes", () => {
    const rule = makeRule({ dayKey: yesterday, dailyVolume: 50_000_000n, roundsToday: 5 });
    const next = maybeRollDayKey(rule);
    expect(next.dayKey).not.toBe(yesterday);
    expect(next.dailyVolume).toBe(0n);
    expect(next.roundsToday).toBe(0);
  });

  it("keeps counters when day key matches", () => {
    const rule = makeRule();
    const next = maybeRollDayKey(rule);
    expect(next.dayKey).toBe(rule.dayKey);
    expect(next.dailyVolume).toBe(rule.dailyVolume);
    expect(next.roundsToday).toBe(rule.roundsToday);
  });
});

// ─── findNextWindowMarket ─────────────────────────────────────────────

describe("findNextWindowMarket", () => {
  const candidates = [
    { marketId: "m1", pool: "p1", intervalSec: 3600, expiry: 2000, status: 1 },
    { marketId: "m2", pool: "p2", intervalSec: 3600, expiry: 3000, status: 1 },
    { marketId: "m3", pool: "p3", intervalSec: 3600, expiry: 4000, status: 1 },
    { marketId: "m4", pool: "p4", intervalSec: 3600, expiry: 5000, status: 2 }, // Locked
    { marketId: "m5", pool: "p5", intervalSec: 3600, expiry: 20, status: 1 }, // Expiring soon
  ];

  it("skips current market and returns latest valid", () => {
    // now is 0, so expiry 5000 is valid (5000-0=5000 >= 30)
    const next = findNextWindowMarket("m1", candidates, 0);
    expect(next).not.toBeNull();
    expect(next!.marketId).toBe("m2"); // m4 is locked, m5 expires too soon
  });

  it("returns null when all candidates are expired or locked", () => {
    const next = findNextWindowMarket("m1", candidates, 4500);
    expect(next).toBeNull(); // only m4 (locked) and m5 (expired soon) left
  });

  it("returns null when candidates is empty", () => {
    expect(findNextWindowMarket("m1", [], 0)).toBeNull();
  });

  it("excludes the current marketId", () => {
    const next = findNextWindowMarket("m3", candidates, 0);
    expect(next).not.toBeNull();
    expect(next!.marketId).not.toBe("m3");
  });

  it("filters candidates to the same asset and interval when supplied", () => {
    const next = findNextWindowMarket("m1", [
      { marketId: "other", pool: "p", intervalSec: 3600, expiry: 100, status: 1, asset: "ETH" },
      { marketId: "same", pool: "p", intervalSec: 3600, expiry: 200, status: 1, asset: "BTC" },
      { marketId: "wrong-cadence", pool: "p", intervalSec: 900, expiry: 150, status: 1, asset: "BTC" },
    ], 0, 30, { asset: "BTC", intervalSec: 3600 });
    expect(next?.marketId).toBe("same");
  });
});
