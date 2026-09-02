/**
 * @followdot/skill-score — Probability Calibration
 *
 * Tracks how well a whale's implied confidence (fill price) matches their
 * actual resolution rate. A well-calibrated whale who buys at 0.70 implied
 * probability and wins 70% of the time has genuine edge.
 *
 * No SDK dependencies — pure math, fully testable in isolation.
 *
 * (see plans/followdot-phase2-spec.md §3 F8)
 */

/** A fill with its implied probability and resolution outcome. */
export interface CalibrationFill {
  /** Implied probability of the outcome the whale took (0–1). */
  fillPrice: number;
  /** Whether the whale's position won at resolution. */
  won: boolean;
  /** Market type for per-market-type bucketing (e.g. "BTC_hourly"). */
  marketType?: string;
}

/** One probability bucket with actual win-rate stats. */
export interface CalibrationBucket {
  /** Lower bound (inclusive), e.g. 0.50 */
  lowerBound: number;
  /** Upper bound (exclusive), e.g. 0.55 */
  upperBound: number;
  /** Midpoint, e.g. 0.525 */
  midpoint: number;
  /** Number of winning fills in this bucket. */
  wins: number;
  /** Total fills in this bucket. */
  total: number;
  /** Actual win rate = wins / total (0 if empty). */
  actualWinRate: number;
}

/** Result of calibration scoring. */
export interface CalibrationResult {
  /** Score in [0, 1]. 1 = perfectly calibrated, 0 = maximally miscalibrated. */
  score: number;
  /** The non-empty buckets that contributed to the score. */
  buckets: CalibrationBucket[];
  /** Mean absolute deviation from bucket midpoints. */
  meanAbsDeviation: number;
}

/** Options for bucketing fills. */
export interface CalibrationOptions {
  /** Bucket width in probability space. Default 0.05 (5pp). */
  bucketWidth?: number;
  /** Lower bound of the lowest bucket. Default 0.50. */
  minProbability?: number;
  /** Upper bound of the highest bucket. Default 0.95. */
  maxProbability?: number;
  /** If set, compute calibration per market type. */
  byMarketType?: boolean;
}

/** Default bucket edges: 50-55%, 55-60%, ..., 90-95% */
const DEFAULT_MIN = 0.50;
const DEFAULT_MAX = 0.95;
const DEFAULT_WIDTH = 0.05;

/**
 * Build calibration buckets from a set of fills.
 *
 * Fills with fillPrice outside [minProbability, maxProbability) are excluded.
 * Buckets with zero fills are omitted from the result.
 *
 * If `byMarketType` is set, fills are grouped by marketType first, then
 * bucketed — returned as separate entries per market type.
 */
export function buildCalibrationBuckets(
  fills: CalibrationFill[],
  opts: CalibrationOptions = {},
): CalibrationBucket[] | Map<string, CalibrationBucket[]> {
  const min = opts.minProbability ?? DEFAULT_MIN;
  const max = opts.maxProbability ?? DEFAULT_MAX;
  const width = opts.bucketWidth ?? DEFAULT_WIDTH;

  if (opts.byMarketType) {
    const types = new Set<string>();
    for (const f of fills) {
      if (f.marketType) types.add(f.marketType);
    }

    const result = new Map<string, CalibrationBucket[]>();
    for (const type of types) {
      const typeFills = fills.filter((f) => f.marketType === type);
      result.set(type, bucketize(typeFills, min, max, width));
    }
    return result;
  }

  return bucketize(fills, min, max, width);
}

/** Internal: sort fills into buckets. */
function bucketize(
  fills: CalibrationFill[],
  min: number,
  max: number,
  width: number,
): CalibrationBucket[] {
  const bucketCount = Math.round((max - min) / width);
  const buckets: CalibrationBucket[] = [];

  for (let i = 0; i < bucketCount; i++) {
    const lower = min + i * width;
    const upper = lower + width;
    const midpoint = (lower + upper) / 2;
    buckets.push({
      lowerBound: lower,
      upperBound: upper,
      midpoint,
      wins: 0,
      total: 0,
      actualWinRate: 0,
    });
  }

  for (const f of fills) {
    const price = f.fillPrice;
    if (!Number.isFinite(price) || price < min || price >= max) continue;

    // +1e-9 guards against floating-point drift at bucket boundaries
    // (e.g. 0.60 - 0.50 === 0.09999999999999998 in IEEE-754)
    const idx = Math.floor((price - min) / width + 1e-9);
    if (idx < 0 || idx >= buckets.length) continue;

    const bucket = buckets[idx];
    bucket.total++;
    if (f.won) bucket.wins++;
  }

  // Compute actual win rates, drop empty buckets
  return buckets
    .filter((b) => b.total > 0)
    .map((b) => ({
      ...b,
      actualWinRate: b.wins / b.total,
    }));
}

/**
 * Compute the calibration score from a set of buckets.
 *
 *   score = 1 - mean(abs(actualWinRate - bucketMidpoint))
 *
 * Perfectly calibrated (actual === midpoint for every bucket) → 1.0.
 * Returns 0 if there are no buckets (insufficient data).
 * Score is clamped to [0, 1].
 */
export function computeCalibrationScore(
  buckets: CalibrationBucket[],
): number {
  if (buckets.length === 0) return 0;

  let totalDeviation = 0;
  for (const b of buckets) {
    totalDeviation += Math.abs(b.actualWinRate - b.midpoint);
  }
  const meanAbsDeviation = totalDeviation / buckets.length;

  // Clamp to [0, 1] — extreme miscalibration can produce deviations > 1
  return Math.max(0, Math.min(1, 1 - meanAbsDeviation));
}

/**
 * Convenience: build buckets and compute the score in one call.
 * Returns a CalibrationResult with the score, non-empty buckets, and MAD.
 */
export function computeCalibration(
  fills: CalibrationFill[],
  opts: CalibrationOptions = {},
): CalibrationResult {
  const rawBuckets = buildCalibrationBuckets(fills, opts);

  // Flatten per-market-type maps into a single array with a marker
  let buckets: CalibrationBucket[];
  if (rawBuckets instanceof Map) {
    // Aggregate across market types for the overall score
    buckets = [];
    const aggregated = new Map<number, CalibrationBucket>();
    for (const typeBuckets of rawBuckets.values()) {
      for (const b of typeBuckets) {
        const key = b.lowerBound;
        const existing = aggregated.get(key);
        if (existing) {
          existing.wins += b.wins;
          existing.total += b.total;
        } else {
          aggregated.set(key, { ...b });
        }
      }
    }
    for (const b of aggregated.values()) {
      if (b.total > 0) {
        buckets.push({ ...b, actualWinRate: b.wins / b.total });
      }
    }
  } else {
    buckets = rawBuckets;
  }

  const meanAbsDeviation =
    buckets.length === 0
      ? 0
      : buckets.reduce((sum, b) => sum + Math.abs(b.actualWinRate - b.midpoint), 0) /
        buckets.length;

  return {
    score: computeCalibrationScore(buckets),
    buckets,
    meanAbsDeviation,
  };
}
