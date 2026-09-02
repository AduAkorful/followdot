/**
 * @followdot/skill-score — Fair-value computations
 *
 * Pure-math functions for computing the fair value of a binary event-contract
 * fill and the edge (in basis points) between the fill price and that fair value.
 *
 * Model: simplified closed-form Black-Scholes Phi(d2) with EWMA volatility.
 * No SDK dependencies — fully testable in isolation.
 *
 * (see plans/followdot-phase2-spec.md §3 F7)
 */

/** sqrt(2), used to convert between erf and normal CDF. */
const SQRT2 = Math.SQRT2;

// ── Abramowitz & Stegun 7.1.26 erf approximation (max error ~1.5e-7) ──
const ERF_P = 0.3275911;
const ERF_A1 = 0.254829592;
const ERF_A2 = -0.284496736;
const ERF_A3 = 1.421413741;
const ERF_A4 = -1.453152027;
const ERF_A5 = 1.061405429;

/**
 * Standard normal CDF: P(Z <= z).
 *
 * Uses the Abramowitz & Stegun 7.1.26 approximation for the error function,
 * with symmetry handling for negative z, and clamping to [0, 1] at the tails
 * to guard against floating-point drift at extreme values.
 *
 * Cross-checked against known values:
 *   Phi(0)     = 0.5
 *   Phi(1.96)  ≈ 0.9750
 *   Phi(-1.96) ≈ 0.0250
 */
export function normalCdf(z: number): number {
  if (Number.isNaN(z)) return NaN;
  if (z === Infinity) return 1;
  if (z === -Infinity) return 0;

  const scaled = z / SQRT2; // erf argument
  const absScaled = Math.abs(scaled);

  // A&S 7.1.26 polynomial in t = 1/(1 + p|x|)
  const t = 1 / (1 + ERF_P * absScaled);
  const poly = (((((ERF_A5 * t + ERF_A4) * t + ERF_A3) * t + ERF_A2) * t + ERF_A1) * t);
  const erfAbs = 1 - poly * Math.exp(-absScaled * absScaled);

  // erf is odd: erf(-x) = -erf(x)
  const erf = scaled >= 0 ? erfAbs : -erfAbs;
  const cdf = 0.5 * (1 + erf);

  // Clamp to [0, 1] — at extreme tails the approximation can drift by ~1e-7
  return Math.max(0, Math.min(1, cdf));
}

/**
 * Compute the fair-value probability of a binary outcome at fill time,
 * using a simplified Black-Scholes Phi(d2) model.
 *
 *   d2 = [ln(S/S0) + (sigma^2/2) * tau] / (sigma * sqrt(tau))
 *   fairProb = Phi(d2)
 *
 * @param S0     — market opening price (strike), from BinaryMarket metadata
 * @param S      — price at fill time (the fill's fillPrice)
 * @param sigma  — EWMA realized volatility from mark-price history
 * @param tau    — time remaining at fill (seconds → years)
 * @returns      — fair-value probability in [0, 1], or NaN for degenerate inputs
 */
export function computeFairValue(
  S0: number,
  S: number,
  sigma: number,
  tau: number,
): number {
  // Degenerate inputs → NaN so callers can fall back
  if (
    !Number.isFinite(S0) ||
    !Number.isFinite(S) ||
    !Number.isFinite(sigma) ||
    !Number.isFinite(tau) ||
    S0 <= 0 ||
    S <= 0 ||
    sigma <= 0 ||
    tau <= 0
  ) {
    return NaN;
  }

  const d2 =
    (Math.log(S / S0) + (sigma * sigma) / 2 * tau) /
    (sigma * Math.sqrt(tau));

  return normalCdf(d2);
}

/**
 * Compute the edge (in basis points) between a fill price and a fair value.
 *
 *   edge_bps = (fillPrice - fairValue) * 10000
 *
 * - Green (positive) edge = favorable entry (whale bought below fair value).
 * - Red (negative) edge = unfavorable entry (whale overpaid).
 * - NaN if either input is NaN — caller should fall back to historical
 *   resolution rate as the fair value.
 *
 * Properties:
 *   - Zero when fillPrice === fairValue.
 *   - Scales linearly by 10000 (1.0 = 10000 bps).
 *   - Propagates NaN from degenerate inputs.
 *   - computeEdgeBps(a, b) === -computeEdgeBps(b, a) (exact negation).
 */
export function computeEdgeBps(fillPrice: number, fairValue: number): number {
  if (!Number.isFinite(fillPrice) || !Number.isFinite(fairValue)) return NaN;
  return (fillPrice - fairValue) * 10_000;
}

/**
 * EWMA (exponentially weighted moving average) realized volatility
 * from a series of prices.
 *
 * Returns 0 when there are fewer than 2 price observations, or when the
 * price series is constant (no volatility). Always non-negative and finite.
 *
 * @param prices  — sequential price observations (e.g. mark prices or fills)
 * @param lambda  — decay factor in (0, 1); defaults to 0.94 (RiskMetrics)
 */
export function ewmaVolatility(
  prices: readonly number[],
  lambda: number = 0.94,
): number {
  if (prices.length < 2) return 0;

  // Work with finite prices only
  const clean: number[] = [];
  for (const p of prices) {
    if (Number.isFinite(p)) clean.push(p);
  }
  if (clean.length < 2) return 0;

  // Simple returns — robust at the 0/1 bounds of probability-scale prices
  const returns: number[] = [];
  for (let i = 1; i < clean.length; i++) {
    const prev = clean[i - 1];
    const curr = clean[i];
    if (prev > 0) {
      returns.push(curr / prev - 1);
    } else if (curr > 0) {
      returns.push(1);
    } else {
      returns.push(0);
    }
  }

  if (returns.length === 0) return 0;

  // Constant series → zero volatility
  const allZero = returns.every((r) => r === 0);
  if (allZero) return 0;

  // EWMA variance: seed with first squared return, then recurse
  const clampedLambda = Math.max(0.0001, Math.min(0.9999, lambda));
  let ewmaVar = returns[0] * returns[0];
  for (let i = 1; i < returns.length; i++) {
    ewmaVar = clampedLambda * ewmaVar + (1 - clampedLambda) * returns[i] * returns[i];
  }

  const vol = Math.sqrt(ewmaVar);
  if (!Number.isFinite(vol) || vol < 0) return 0;
  return vol;
}
