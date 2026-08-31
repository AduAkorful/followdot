/**
 * @followdot/skill-score
 *
 * Skill scoring for DreamDEX Event Contract wallets.
 *
 * A wallet's "skill" is measured by *consistent edge*, not raw PnL.
 *
 * Formula (see plans/followdot-product-spec.md §11, decision #1):
 *
 *   skillScore = bayesianWinRate × consistencyFactor − variancePenalty
 *
 * where:
 *   - bayesianWinRate = (wins + 1) / (totalMarkets + 2)   [Laplace smoothing, α=1]
 *   - consistencyFactor = fraction of market-type buckets where winRate ≥ 0.5
 *   - variancePenalty = min(cv(realizedPnL), 0.5)   [coefficient of variation, capped]
 *     If mean PnL ≈ 0 with non-zero variance, penalty = max (pure noise).
 */

export interface MarketResult {
  marketId: string;
  marketType: string; // e.g. "BTC_hourly", "ETH_daily"
  pnl: number;        // realized PnL in USDso (positive = win, negative = loss)
  isUp: boolean;      // whether the wallet held the Up outcome (informational)
}

export interface SkillScoreInput {
  address: string;
  settledMarkets: MarketResult[];
}

export interface SkillScoreResult {
  address: string;
  score: number;          // [0, 1] normalized
  winRate: number;        // raw win rate (wins / total)
  bayesianWinRate: number;
  consistencyFactor: number;
  variancePenalty: number;
  totalMarkets: number;
  totalRealizedPnL: number;
  lastUpdated: number;    // epoch milliseconds (Date.now())
}

/** Laplace smoothing parameter for win-rate shrinkage. Spec §11 #1 mandates α=5. */
const LAPLACE_ALPHA = 5;
/** Max variance penalty (prevents a single huge-loss trade from zeroing the score). */
const MAX_VARIANCE_PENALTY = 0.5;

/**
 * Compute the skill score for a single wallet.
 * Returns a score in [0, 1].
 */
export function computeSkillScore(input: SkillScoreInput): SkillScoreResult {
  const { address, settledMarkets } = input;
  const totalMarkets = settledMarkets.length;

  if (totalMarkets === 0) {
    return {
      address,
      score: 0,
      winRate: 0,
      bayesianWinRate: LAPLACE_ALPHA / (2 * LAPLACE_ALPHA),
      consistencyFactor: 0,
      variancePenalty: 0,
      totalMarkets: 0,
      totalRealizedPnL: 0,
      lastUpdated: Date.now(),
    };
  }

  // --- Win / loss accounting ---
  let wins = 0;
  let totalPnL = 0;
  const pnls: number[] = [];
  const marketTypes = new Map<string, { wins: number; total: number }>();

  for (const m of settledMarkets) {
    const won = m.pnl >= 0;
    if (won) wins++;
    totalPnL += m.pnl;
    pnls.push(m.pnl);

    const existing = marketTypes.get(m.marketType) ?? { wins: 0, total: 0 };
    if (won) existing.wins++;
    existing.total++;
    marketTypes.set(m.marketType, existing);
  }

  const winRate = wins / totalMarkets;
  const bayesianWinRate = (wins + LAPLACE_ALPHA) / (totalMarkets + 2 * LAPLACE_ALPHA);

  // --- Consistency: fraction of market-type buckets where winRate ≥ 0.5 ---
  let consistentBuckets = 0;
  for (const { wins: w, total: t } of marketTypes.values()) {
    if (w / t >= 0.5) consistentBuckets++;
  }
  const consistencyFactor = marketTypes.size > 0 ? consistentBuckets / marketTypes.size : 0;

  // --- Variance penalty: coefficient of variation of realized PnL ---
  let variancePenalty = 0;
  if (pnls.length > 1) {
    const mean = totalPnL / pnls.length;
    const variance = pnls.reduce((acc, p) => acc + (p - mean) ** 2, 0) / pnls.length;
    const stdDev = Math.sqrt(variance);
    if (Math.abs(mean) > 0.01 && stdDev > 0.01) {
      const cv = stdDev / Math.abs(mean);
      variancePenalty = Math.min(cv, MAX_VARIANCE_PENALTY);
    } else if (stdDev > 0.01) {
      // Mean ≈ 0 but there is variance — pure noise, maximum penalty.
      variancePenalty = MAX_VARIANCE_PENALTY;
    }
  }

  // --- Final composite score ---
  const rawScore = bayesianWinRate * consistencyFactor - variancePenalty;
  // Normalize to [0, 1]
  const score = Math.max(0, Math.min(1, (rawScore + MAX_VARIANCE_PENALTY) / (1 + MAX_VARIANCE_PENALTY)));

  return {
    address,
    score,
    winRate,
    bayesianWinRate,
    consistencyFactor,
    variancePenalty,
    totalMarkets,
    totalRealizedPnL: totalPnL,
    lastUpdated: Date.now(),
  };
}

/**
 * Compute skill scores for multiple wallets.
 * Returns sorted by score descending.
 */
export function rankWallets(inputs: SkillScoreInput[]): SkillScoreResult[] {
  return inputs
    .map(computeSkillScore)
    .sort((a, b) => b.score - a.score);
}
