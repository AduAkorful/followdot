/**
 * Honest open-position display helpers.
 *
 * DreamDEX reconstructs costBasis from indexed fills + router actions. When that
 * fold is incomplete, costBasis stays 0n while balanceYes/balanceNo still show
 * live holdings — rendering stake as "$0.00" falsely implies a closed/empty
 * position. Prefer share qty + mark, and "—" for unknown stake / unrealized PnL.
 */

export type OpenPositionBalances = {
  balanceYes: bigint;
  balanceNo: bigint;
  costBasis: bigint;
  markValue: bigint;
  unrealizedPnl: bigint;
  market: { quoteDecimals: number };
};

export type HonestOpenPositionMoney = {
  /** Human share qty of the held outcome (YES or NO). */
  sharesHuman: number;
  /** Cost basis in human collateral, or null when reconstruction is incomplete. */
  stakeHuman: number | null;
  /** Mark value of current balances (book/settlement). */
  markHuman: number;
  /** mark − cost when cost basis is known; otherwise null. */
  unrealizedPnlHuman: number | null;
  /** True when shares are held but costBasis is 0 (incomplete fill fold). */
  costBasisUnknown: boolean;
};

function scaleRaw(raw: bigint, decimals: number): number {
  return Number(raw) / 10 ** decimals;
}

/**
 * Map raw SDK open-position PnL fields into honest human display values.
 * Returns null when decimals are unusable or no single-sided holding exists.
 */
export function mapHonestOpenPositionMoney(
  position: OpenPositionBalances,
): HonestOpenPositionMoney | null {
  const decimals = position.market.quoteDecimals;
  if (!Number.isInteger(decimals) || decimals < 0) return null;

  const yesHeld = position.balanceYes > 0n;
  const noHeld = position.balanceNo > 0n;
  if (yesHeld === noHeld) return null;

  const heldRaw = yesHeld ? position.balanceYes : position.balanceNo;
  const sharesHuman = scaleRaw(heldRaw, decimals);
  const markHuman = scaleRaw(position.markValue, decimals);
  const costBasisUnknown = position.costBasis === 0n && heldRaw > 0n;

  return {
    sharesHuman,
    stakeHuman: costBasisUnknown ? null : scaleRaw(position.costBasis, decimals),
    markHuman,
    unrealizedPnlHuman: costBasisUnknown
      ? null
      : scaleRaw(position.unrealizedPnl, decimals),
    costBasisUnknown,
  };
}

/** Format stake / PnL money: null → "—", else `$x.xx` (optional sign for PnL). */
export function formatOpenPositionMoney(
  value: number | null,
  opts?: { signed?: boolean },
): string {
  if (value === null || !Number.isFinite(value)) return '—';
  if (opts?.signed) {
    const sign = value >= 0 ? '+' : '';
    return `${sign}$${value.toFixed(2)}`;
  }
  return `$${value.toFixed(2)}`;
}

export function formatSharesHuman(shares: number): string {
  if (!Number.isFinite(shares)) return '—';
  return shares.toFixed(2);
}

/**
 * Exposure contribution in human collateral for risk gates.
 * Prefer reconstructed cost basis; when incomplete, fall back to mark so open
 * share holdings are not counted as $0 exposure.
 */
export function exposureHumanFromOpenPosition(
  position: OpenPositionBalances,
): number {
  const mapped = mapHonestOpenPositionMoney(position);
  if (!mapped) {
    const decimals = position.market.quoteDecimals;
    if (!Number.isInteger(decimals) || decimals < 0) return 0;
    return scaleRaw(position.costBasis, decimals);
  }
  if (mapped.stakeHuman !== null) return mapped.stakeHuman;
  return mapped.markHuman;
}
