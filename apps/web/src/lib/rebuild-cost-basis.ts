/**
 * Rebuild incomplete open-position costBasis from indexed fills.
 *
 * DreamDEX `getOpenPositionsWithPnL` folds fills by *pool* (recycled across
 * markets) and may leave costBasis=0n while balanceYes/balanceNo still show
 * live holdings. Reconstruct avg-cost basis from fills keyed by stable
 * market id (buy cost − sells), matching the SDK's pnlEventsFor +
 * computePositionPnL engine without inventing stake when fills are insufficient.
 */
import {
  computePositionPnL,
  pnlEventsFor,
  type FillRow,
  type OpenPositionPnL,
} from '@somnia-chain/markets-sdk';

export type RebuildCostBasisInput = {
  account: string;
  /** User/whale fills (any markets); filtered to `marketId` inside. */
  fills: FillRow[];
  marketId: string;
  balanceYes: bigint;
  balanceNo: bigint;
  quoteDecimals: number;
  lastPrice?: string | null;
  winningOutcome?: number | null;
  voided?: boolean;
};

export type RebuiltCostBasis = {
  costBasis: bigint;
  markValue: bigint;
  unrealizedPnl: bigint;
  /** Number of buy/sell events that entered the fold. */
  fillEventCount: number;
};

/**
 * Reconstruct remaining cost basis of held shares from market-scoped fills.
 * Returns null when fills cannot support a positive cost for current holdings
 * (no fills, sides not bridged, or fold leaves costBasis at 0).
 */
export function rebuildCostBasisFromFills(
  input: RebuildCostBasisInput,
): RebuiltCostBasis | null {
  const held = input.balanceYes + input.balanceNo;
  if (held <= 0n) return null;
  if (!Number.isInteger(input.quoteDecimals) || input.quoteDecimals < 0) {
    return null;
  }
  if (!input.account || !input.marketId) return null;

  const marketId = input.marketId.toLowerCase();
  const marketFills = input.fills.filter(
    (f) => (f.market ?? '').toLowerCase() === marketId,
  );
  if (marketFills.length === 0) return null;

  // Fills only — router mint/merge actions are not always available on the
  // web path; if they dominated the position, we correctly fall back to null.
  const events = pnlEventsFor(input.account, marketFills, []);
  if (events.length === 0) return null;

  const oneCollateral = 10n ** BigInt(input.quoteDecimals);
  const pnl = computePositionPnL(
    events,
    { balanceYes: input.balanceYes, balanceNo: input.balanceNo },
    {
      quoteDecimals: input.quoteDecimals,
      lastPrice: input.lastPrice ?? null,
      winningOutcome: input.winningOutcome ?? null,
      voided: input.voided ?? false,
    },
    oneCollateral,
  );

  // Insufficient inventory story → keep honest "—" at the display layer.
  if (pnl.costBasis <= 0n) return null;

  return {
    costBasis: pnl.costBasis,
    markValue: pnl.markValue,
    unrealizedPnl: pnl.unrealizedPnl,
    fillEventCount: events.length,
  };
}

/**
 * When SDK costBasis is 0n but shares are held, patch with a fill-based rebuild.
 * Preserves SDK markValue when present (book-aware); recomputes unrealized as
 * mark − rebuilt cost. No-op when rebuild is impossible.
 */
export function withRebuiltCostBasis<T extends OpenPositionPnL>(
  position: T,
  account: string,
  fills: FillRow[],
): T {
  const held = position.balanceYes + position.balanceNo;
  if (position.costBasis !== 0n || held <= 0n) return position;

  const rebuilt = rebuildCostBasisFromFills({
    account,
    fills,
    marketId: position.market.id,
    balanceYes: position.balanceYes,
    balanceNo: position.balanceNo,
    quoteDecimals: position.market.quoteDecimals,
    lastPrice: position.market.lastPrice,
    winningOutcome: position.market.winningOutcome ?? null,
    voided: position.market.voided,
  });
  if (!rebuilt) return position;

  const markValue =
    position.markValue > 0n ? position.markValue : rebuilt.markValue;

  return {
    ...position,
    costBasis: rebuilt.costBasis,
    markValue,
    unrealizedPnl: markValue - rebuilt.costBasis,
  };
}
