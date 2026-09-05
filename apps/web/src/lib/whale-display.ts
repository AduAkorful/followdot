/**
 * Honest display helpers for whale leaderboard / profile UI.
 * Never invent rank percentiles from skill-score floors.
 * Never label every whale "Consistent".
 */

export type RankStatus = "ranked" | "unranked";
export type TrendDirection = "up" | "down" | "neutral";

export interface RankDisplay {
  status: RankStatus;
  rank: number | null;
  total: number | null;
  percentile: number | null;
  percentileLabel: string | null;
  whaleLabel: "Ranked Whale" | "Unranked";
}

/** Live leaderboard rank only — missing params stay Unranked, not "Top 25%". */
export function resolveRankDisplay(
  rank: number | null,
  total: number | null,
): RankDisplay {
  const liveRank = rank !== null && Number.isInteger(rank) && rank > 0 ? rank : null;
  const liveTotal = total !== null && Number.isInteger(total) && total > 0 ? total : null;
  const hasLive = liveRank !== null && liveTotal !== null && liveRank <= liveTotal;

  if (!hasLive) {
    return {
      status: "unranked",
      rank: null,
      total: null,
      percentile: null,
      percentileLabel: null,
      whaleLabel: "Unranked",
    };
  }

  const percentile = Math.round((1 - liveRank / liveTotal) * 100);
  const percentileLabel =
    percentile >= 95 ? "Top 5%" :
    percentile >= 90 ? "Top 10%" :
    percentile >= 75 ? "Top 25%" :
    null;

  return {
    status: "ranked",
    rank: liveRank,
    total: liveTotal,
    percentile,
    percentileLabel,
    whaleLabel: "Ranked Whale",
  };
}

export interface ConsistencyDisplay {
  label: string;
  trend: TrendDirection;
  subtitle: string;
}

/**
 * Chip from the real score parts:
 *   consistencyFactor — fraction of market-type buckets with winRate ≥ 0.5
 *   variancePenalty   — [0, 0.5] PnL coefficient-of-variation cap
 */
export function resolveConsistencyDisplay(
  consistencyFactor: number,
  variancePenalty: number,
): ConsistencyDisplay {
  const cf = Number.isFinite(consistencyFactor) ? consistencyFactor : 0;
  const vp = Number.isFinite(variancePenalty) ? variancePenalty : 0;
  const highVariance = vp >= 0.25;
  const typeConsistent = cf >= 0.7;
  const typeFair = cf >= 0.5;

  if (highVariance && typeFair) {
    return {
      label: "Uneven",
      trend: "down",
      subtitle: `High PnL variance (penalty ${(vp * 100).toFixed(0)}%)`,
    };
  }
  if (highVariance) {
    return {
      label: "Volatile",
      trend: "down",
      subtitle: "High PnL variance, uneven market types",
    };
  }
  if (typeConsistent) {
    return {
      label: "Consistent",
      trend: "up",
      subtitle: "Stable win rate across market types",
    };
  }
  if (typeFair) {
    return {
      label: "Mixed",
      trend: "neutral",
      subtitle: "Some market types hold a 50%+ win rate",
    };
  }
  return {
    label: "Inconsistent",
    trend: "down",
    subtitle: "Few market types hold a winning win rate",
  };
}

/** Signed USD compact format for KPI cards (net sums may be negative). */
export function formatSignedUsd(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

export function formatSnapshotLabel(iso: string | null | undefined): string | null {
  if (!iso || typeof iso !== "string") return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString();
}

export function sumNetRealizedPnL(pnls: Array<number | null | undefined>): number {
  return pnls.reduce<number>((acc, v) => acc + (typeof v === "number" && Number.isFinite(v) ? v : 0), 0);
}
