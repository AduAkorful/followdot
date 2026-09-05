import { describe, expect, it } from 'vitest';
import type { FillRow, OpenPositionPnL } from '@somnia-chain/markets-sdk';
import { sumExposureHumanFromPositions } from './dreamdex';

const ACCOUNT = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const MARKET = '0x1111111111111111111111111111111111111111111111111111111111111111';
const POOL = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function fill(
  partial: Partial<FillRow> & Pick<FillRow, 'id' | 'fillPrice' | 'quantity' | 'timestamp'>,
): FillRow {
  return {
    market: MARKET,
    pool: POOL,
    quoteQuantity: '0',
    maker: null,
    makerSide: null,
    taker: ACCOUNT,
    takerSide: 'BUY_YES',
    kind: 'DIRECT_YES',
    takerIsBid: true,
    takerOrder: { owner: ACCOUNT, side: 'BUY_YES' },
    txHash: '0xdead',
    ...partial,
  };
}

const basePosition = {
  balanceYes: 2_000_000n,
  balanceNo: 0n,
  costBasis: 0n,
  markValue: 1_100_000n,
  unrealizedPnl: 1_100_000n,
  market: {
    id: MARKET,
    quoteDecimals: 6,
    lastPrice: '550000',
    winningOutcome: null,
    voided: false,
  },
} as unknown as OpenPositionPnL;

describe('sumExposureHumanFromPositions', () => {
  it('uses mark fallback when no fills can rebuild costBasis', () => {
    expect(sumExposureHumanFromPositions([basePosition], ACCOUNT, [])).toBe(1.1);
  });

  it('prefers rebuilt costBasis when fills are available', () => {
    // Bought 2 YES @ 0.40 → cost 0.80 collateral
    const fills = [
      fill({
        id: '1',
        fillPrice: '400000',
        quantity: '2000000',
        timestamp: '100',
        takerSide: 'BUY_YES',
        takerOrder: { owner: ACCOUNT, side: 'BUY_YES' },
      }),
    ];
    expect(sumExposureHumanFromPositions([basePosition], ACCOUNT, fills)).toBe(0.8);
  });
});
