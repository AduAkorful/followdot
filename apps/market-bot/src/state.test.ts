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
});
