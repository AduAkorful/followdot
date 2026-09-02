/**
 * @followdot/sdk-helpers/roll-state
 *
 * Pure, side-effect-free state machine for auto-roll lifecycle management (F9).
 *
 * States:
 *   WAITING  — position queued, awaiting market window
 *   OPEN     — position active in a live binary market
 *   WINNER   — market settled, whale's side won; eligible to roll
 *   LOSER    — market settled, whale's side lost; eligible to halt
 *   VOID     — market voided; skip with no action
 *   HALTED   — consecutive-loss limit reached; stop copying
 *
 * Guardrails (per-rule):
 *   cashOutTarget   — profit % threshold to take profits (e.g. 150 = 150%)
 *   stopLossRounds  — consecutive losses before halting
 *   maxRounds       — max positions per day
 *   dailyCap        — max USDC per day
 */

/** Phases in the auto-roll lifecycle. */
export type RollPhase = "WAITING" | "OPEN" | "WINNER" | "LOSER" | "VOID" | "HALTED";

/** Guardrail thresholds configured per auto-copy rule. */
export interface RollGuardrails {
  /** Take-profit percentage (e.g. 150 means 150% of stake returned → cash out). */
  cashOutTarget: number;
  /** Consecutive losses before halting auto-copy. */
  stopLossRounds: number;
  /** Maximum positions opened per day. */
  maxRounds: number;
  /** Daily USDC cap (raw units, same scale as stake). */
  dailyCap: bigint;
}

/**
 * The full auto-copy rule including guardrails and runtime counters.
 * Stored per follower in KV under `follower:{wallet}:{whale}`.
 */
export interface AutoCopyRule {
  walletAddress: string;
  whaleAddress: string;
  sessionKey: string;
  bankrollCap: number;
  /** Whether auto-roll is enabled for winning positions. */
  autoRoll: boolean;
  guardrails: RollGuardrails;
  /** Per-fill nonce tracking is now KV-backed (24h TTL), not stored here. */
  dailyVolume: bigint;
  dayKey: string; // YYYY-MM-DD UTC
  consecutiveLosses: number;
  roundsToday: number;
  /** Last-seen whale fill ID (for stale-whale guard). */
  lastFillId: string | null;
  status?: "ACTIVE" | "PAUSED";
}

/** 24-hour TTL for processed-fill nonces and follower records. */
export const FILL_NONCE_TTL_SECONDS = 86400;

/** KV key for a per-fill processed-nonce guard: `processed:{follower}:{whale}:{fillId}`. */
export function fillNonceKey(follower: string, whale: string, fillId: string): string {
  return `processed:${follower}:${whale}:${fillId}`;
}

/**
 * A single roll-state record — tracks an open position from entry through
 * settlement and potential roll to the next window market.
 *
 * Stored in KV under `roll:{wallet}:{whale}:{fillId}`.
 */
export interface RollState {
  walletAddress: string;
  whaleAddress: string;
  fillId: string; // `${txHash}:${fillRowId}`
  marketId: string; // binary market id (bytes32)
  pool: string; // marketAddress / clone contract address
  phase: RollPhase;
  entryPrice: number; // fill price (YES probability, 0-1)
  entryTime: number; // epoch seconds
  stake: string; // raw bigint as string (collateral units)
  whaleSide: string; // BUY_YES | SELL_YES | BUY_NO | SELL_NO
  cashOutTarget: number;
  stopLossRounds: number;
  maxRounds: number;
  dailyCap: string; // raw bigint as string
  consecutiveLosses: number;
  roundsToday: number;
  dailyVolume: string; // raw bigint as string
  rolledFromFillId: string | null; // null for the initial position, set on rolls
  /** Initial stake for the roll chain, used for the cash-out target. */
  initialStake?: string;
  /** Cumulative settled proceeds returned by live redemptions. */
  realizedProceeds?: string;
  /** Asset and cadence identify the only valid next-window series. */
  asset?: string;
  intervalSec?: number;
}

/** A settled binary market's outcome, normalized for the state machine. */
export interface SettledMarketInfo {
  marketId: string;
  /** 0 = YES won, 1 = NO won, null = not settled. */
  winningOutcome: number | null;
  voided: boolean;
  resolved: boolean;
}

// ─── Pure state machine transitions ───────────────────────────────────

/**
 * Given the current roll state and the settled market's outcome, produce
 * the next state. Pure function — no KV or network I/O.
 */
export function transitionRollState(
  state: RollState,
  settled: SettledMarketInfo,
): RollState {
  const next: RollState = { ...state };

  switch (state.phase) {
    case "OPEN": {
      if (settled.voided) {
        next.phase = "VOID";
        next.rolledFromFillId = null;
      } else if (settled.winningOutcome !== null) {
        const won = didWhaleSideWin(state.whaleSide, settled.winningOutcome);
        next.phase = won ? "WINNER" : "LOSER";
        next.consecutiveLosses = won ? 0 : next.consecutiveLosses + 1;
      }
      break;
    }

    case "WINNER": {
      // Cash-out check: if profit target met or max rounds reached, halt roll.
      if (shouldHaltAfterWin(state)) {
        next.phase = "HALTED";
      }
      break;
    }

    case "LOSER": {
      if (state.consecutiveLosses >= state.stopLossRounds) {
        next.phase = "HALTED";
      }
      break;
    }
  }

  return next;
}

/**
 * Determine if the whale's binary side won given the market's winning
 * outcome (0=YES, 1=NO).
 */
export function didWhaleSideWin(
  whaleSide: string,
  winningOutcome: number,
): boolean {
  const isYesSide = whaleSide === "BUY_YES" || whaleSide === "SELL_NO";
  const yesWon = winningOutcome === 0;
  return isYesSide === yesWon;
}

/**
 * Post-win decision: should we halt rolling or continue?
 * Returns true when profit target is met or max rounds reached.
 */
export function shouldHaltAfterWin(state: RollState): boolean {
  if (state.roundsToday >= state.maxRounds) return true;
  const initialStake = state.initialStake ? BigInt(state.initialStake) : 0n;
  const realizedProceeds = state.realizedProceeds ? BigInt(state.realizedProceeds) : 0n;
  if (initialStake > 0n && realizedProceeds * 100n >= initialStake * BigInt(state.cashOutTarget)) {
    return true;
  }
  return false;
}

/**
 * Check whether a rule allows opening a new position today.
 * Enforces maxRounds and dailyCap.
 */
export function canOpenPosition(rule: AutoCopyRule, stake: bigint): boolean {
  if (rule.roundsToday >= rule.guardrails.maxRounds) return false;
  if (rule.dailyVolume + stake > rule.guardrails.dailyCap) return false;
  return true;
}

/**
 * Advance the day key if we've crossed midnight UTC. Resets daily counters.
 */
export function maybeRollDayKey(
  rule: AutoCopyRule,
  now: number = Math.floor(Date.now() / 1000),
): AutoCopyRule {
  const today = new Date(now * 1000).toISOString().slice(0, 10);
  if (rule.dayKey !== today) {
    return {
      ...rule,
      dayKey: today,
      dailyVolume: 0n,
      roundsToday: 0,
    };
  }
  return rule;
}

/**
 * Select the next window market to roll into.
 *
 * "Window" markets share the same interval (e.g. hourly events). We pick
 * the latest-listed trading market that is NOT the current one and has
 * sufficient expiry headroom.
 */
export function findNextWindowMarket(
  currentMarketId: string,
  candidateMarkets: Array<{
    marketId: string;
    pool: string;
    intervalSec: number;
    expiry: number;
    status: number;
    asset?: string;
  }>,
  now: number = Math.floor(Date.now() / 1000),
  minHeadroomSec: number = 30,
  criteria?: { asset?: string; intervalSec?: number },
): { marketId: string; pool: string; intervalSec: number } | null {
  const sorted = [...candidateMarkets].sort((a, b) => a.expiry - b.expiry);

  for (const m of sorted) {
    if (m.marketId === currentMarketId) continue;
    if (m.status !== 1) continue; // must be Trading
    if (criteria?.asset && m.asset !== criteria.asset) continue;
    if (criteria?.intervalSec && m.intervalSec !== criteria.intervalSec) continue;
    if (m.expiry - now < minHeadroomSec) continue;
    return {
      marketId: m.marketId,
      pool: m.pool,
      intervalSec: m.intervalSec,
    };
  }

  return null;
}
