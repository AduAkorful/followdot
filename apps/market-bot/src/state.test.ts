import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { emptyState, loadState, saveState } from "./state.js";

describe("market bot state", () => {
  it("round-trips state atomically", async () => {
    const directory = await mkdtemp(join(tmpdir(), "followdot-market-bot-"));
    const path = join(directory, "state.json");
    try {
      const state = emptyState();
      state.inFlight = { marketId: "0xmarket", pool: "0xpool", startedAt: Date.now() };
      state.executedMarketIds = ["0xprevious-market"];
      await saveState(path, state);
      expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({ inFlight: state.inFlight });
      expect((await loadState(path)).inFlight).toEqual(state.inFlight);
      expect((await loadState(path)).executedMarketIds).toEqual(["0xprevious-market"]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("preserves all state fields through a full round-trip", async () => {
    const directory = await mkdtemp(join(tmpdir(), "followdot-market-bot-"));
    const path = join(directory, "state.json");
    try {
      const state = emptyState();
      state.dailyVolumeRaw = "1234567890";
      state.executions = ["0xexe1", "0xexe2"];
      state.executedMarketIds = ["0xmarket1", "0xmarket2"];
      state.dayKey = "2026-09-03";
      await saveState(path, state);
      const loaded = await loadState(path);
      expect(loaded.dailyVolumeRaw).toBe("1234567890");
      expect(loaded.executions).toEqual(["0xexe1", "0xexe2"]);
      expect(loaded.executedMarketIds).toEqual(["0xmarket1", "0xmarket2"]);
      expect(loaded.dayKey).toBe("2026-09-03");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("initializes an empty state with all fields present", () => {
    const state = emptyState();
    expect(state.dailyVolumeRaw).toBe("0");
    expect(state.executions).toEqual([]);
    expect(state.executedMarketIds).toEqual([]);
    expect(state.inFlight).toBeNull();
    expect(state.dayKey).toBeDefined();
  });

  it("creates an empty state when the state file does not exist", async () => {
    const directory = await mkdtemp(join(tmpdir(), "followdot-market-bot-"));
    const path = join(directory, "nonexistent-state.json");
    await rm(directory, { recursive: true, force: true });
    const state = await loadState(path);
    expect(state.dailyVolumeRaw).toBe("0");
    expect(state.executions).toEqual([]);
    expect(state.inFlight).toBeNull();
  });
});
