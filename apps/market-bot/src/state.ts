import { readFile, rename, writeFile } from "node:fs/promises";

export interface InFlightExecution {
  marketId: string;
  pool: string;
  startedAt: number;
  txHash?: string;
}

export interface BotState {
  dayKey: string;
  dailyVolumeRaw: string;
  inFlight: InFlightExecution | null;
  executions: string[];
  executedMarketIds: string[];
}

function dayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function emptyState(now = new Date()): BotState {
  return {
    dayKey: dayKey(now),
    dailyVolumeRaw: "0",
    inFlight: null,
    executions: [],
    executedMarketIds: [],
  };
}

export async function loadState(path: string): Promise<BotState> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as Partial<BotState>;
    if (
      typeof parsed.dayKey !== "string" ||
      typeof parsed.dailyVolumeRaw !== "string" ||
      !Array.isArray(parsed.executions) ||
      (parsed.inFlight !== null && parsed.inFlight !== undefined && typeof parsed.inFlight !== "object")
    ) {
      throw new Error("state file has an invalid shape");
    }
    const state: BotState = {
      dayKey: parsed.dayKey,
      dailyVolumeRaw: parsed.dailyVolumeRaw,
      inFlight: parsed.inFlight ?? null,
      executions: parsed.executions.filter((value): value is string => typeof value === "string"),
      executedMarketIds: Array.isArray(parsed.executedMarketIds)
        ? parsed.executedMarketIds.filter((value): value is string => typeof value === "string")
        : [],
    };
    if (state.dayKey !== dayKey()) return emptyState();
    return state;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return emptyState();
    throw error;
  }
}

export async function saveState(path: string, state: BotState): Promise<void> {
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
}

export function currentDayKey(): string {
  return dayKey();
}
