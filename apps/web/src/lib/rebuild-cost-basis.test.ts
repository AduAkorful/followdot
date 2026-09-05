import { describe, expect, it } from 'vitest';
import type { FillRow, OpenPositionPnL } from '@somnia-chain/markets-sdk';
import {
  rebuildCostBasisFromFills,
  withRebuiltCostBasis,
} from './rebuild-cost-basis';

const ACCOUNT = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const MARKET = '0x1111111111111111111111111111111111111111111111111111111111111111';
const POOL = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function fill(partial: Partial<FillRow> & Pick<FillRow, 'id' | 'fillPrice' | 'quantity' | 'timestamp'>): FillRow {
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

describe('rebuildCostBasisFromFills', () => {
  it('returns null with no fills or no holdings', () => {
    expect(
      rebuildCostBasisFromFills({
        account: ACCOUNT,
        fills: [],
        marketId: MARKET,
        balanceYes: 1_000_000n,
        balanceNo: 0n,
        quoteDecimals: 6,
      }),
    ).toBeNull();

    expect(
      rebuildCostBasisFromFills({
        account: ACCOUNT,
        fills: [fill({ id: '1', fillPrice: '400000', quantity: '1000000', timestamp: '1' })],
        marketId: MARKET,
        balanceYes: 0n,
        balanceNo: 0n,
        quoteDecimals: 6,
      }),
    ).toBeNull();
  });

  it('reconstructs buy cost for held YES shares', () => {
    // Bought 2 YES @ 0.40 → cost 0.80 collateral (800_000 raw @ 6dp)
    const rebuilt = rebuildCostBasisFromFills({
      account: ACCOUNT,
      fills: [
        fill({
          id: '1',
          fillPrice: '400000',
          quantity: '2000000',
          timestamp: '100',
          takerSide: 'BUY_YES',
          takerOrder: { owner: ACCOUNT, side: 'BUY_YES' },
        }),
      ],
      marketId: MARKET,
      balanceYes: 2_000_000n,
      balanceNo: 0n,
      quoteDecimals: 6,
      lastPrice: '500000',
    });
    expect(rebuilt).not.toBeNull();
    expect(rebuilt!.costBasis).toBe(800_000n);
    expect(rebuilt!.fillEventCount).toBe(1);
    // mark @ 0.50 → 1_000_000; unrealized = mark − cost
    expect(rebuilt!.markValue).toBe(1_000_000n);
    expect(rebuilt!.unrealizedPnl).toBe(200_000n);
  });

  it('nets sells out of remaining cost basis', () => {
    // Buy 3 @ 0.40 (cost 1.2), sell 1 @ 0.50 → remaining 2 @ avg 0.40 → cost 0.8
    const rebuilt = rebuildCostBasisFromFills({
      account: ACCOUNT,
      fills: [
        fill({
          id: '2',
          fillPrice: '500000',
          quantity: '1000000',
          timestamp: '200',
          takerSide: 'SELL_YES',
          takerIsBid: false,
          takerOrder: { owner: ACCOUNT, side: 'SELL_YES' },
        }),
        fill({
          id: '1',
          fillPrice: '400000',
          quantity: '3000000',
          timestamp: '100',
          takerSide: 'BUY_YES',
          takerOrder: { owner: ACCOUNT, side: 'BUY_YES' },
        }),
      ],
      marketId: MARKET,
      balanceYes: 2_000_000n,
      balanceNo: 0n,
      quoteDecimals: 6,
      lastPrice: '450000',
    });
    expect(rebuilt).not.toBeNull();
    expect(rebuilt!.costBasis).toBe(800_000n);
    expect(rebuilt!.fillEventCount).toBe(2);
  });

  it('ignores fills from other markets (pool recycle safety)', () => {
    const otherMarket =
      '0x2222222222222222222222222222222222222222222222222222222222222222';
    const rebuilt = rebuildCostBasisFromFills({
      account: ACCOUNT,
      fills: [
        fill({
          id: 'other',
          market: otherMarket,
          fillPrice: '400000',
          quantity: '2000000',
          timestamp: '100',
        }),
      ],
      marketId: MARKET,
      balanceYes: 2_000_000n,
      balanceNo: 0n,
      quoteDecimals: 6,
    });
    expect(rebuilt).toBeNull();
  });

  it('returns null when sides are not bridged', () => {
    const rebuilt = rebuildCostBasisFromFills({
      account: ACCOUNT,
      fills: [
        fill({
          id: '1',
          fillPrice: '400000',
          quantity: '2000000',
          timestamp: '100',
          taker: ACCOUNT,
          takerSide: null,
          takerOrder: null,
          maker: null,
          makerSide: null,
        }),
      ],
      marketId: MARKET,
      balanceYes: 2_000_000n,
      balanceNo: 0n,
      quoteDecimals: 6,
    });
    expect(rebuilt).toBeNull();
  });

  it('reconstructs NO-side cost (price inverted from YES terms)', () => {
    // BUY_NO 2 @ YES 0.40 → NO price 0.60 → cost 1.2
    const rebuilt = rebuildCostBasisFromFills({
      account: ACCOUNT,
      fills: [
        fill({
          id: '1',
          fillPrice: '400000',
          quantity: '2000000',
          timestamp: '100',
          takerSide: 'BUY_NO',
          takerIsBid: false,
          takerOrder: { owner: ACCOUNT, side: 'BUY_NO' },
        }),
      ],
      marketId: MARKET,
      balanceYes: 0n,
      balanceNo: 2_000_000n,
      quoteDecimals: 6,
      lastPrice: '400000',
    });
    expect(rebuilt).not.toBeNull();
    expect(rebuilt!.costBasis).toBe(1_200_000n);
  });
});

describe('withRebuiltCostBasis', () => {
  const basePosition = {
    balanceYes: 2_000_000n,
    balanceNo: 0n,
    costBasis: 0n,
    avgCost: 0n,
    markValue: 1_000_000n,
    unrealizedPnl: 1_000_000n,
    realizedPnl: 0n,
    market: {
      id: MARKET,
      marketAddress: POOL,
      poolAddress: POOL,
      quoteDecimals: 6,
      lastPrice: '500000',
      winningOutcome: null,
      voided: false,
      status: 'Trading',
      asset: 'BTC',
      interval: '5m',
      question: null,
      expiry: null,
    },
  } as unknown as OpenPositionPnL;

  it('patches incomplete costBasis from fills and recomputes unrealized', () => {
    const fills = [
      fill({
        id: '1',
        fillPrice: '400000',
        quantity: '2000000',
        timestamp: '100',
      }),
    ];
    const patched = withRebuiltCostBasis(basePosition, ACCOUNT, fills);
    expect(patched.costBasis).toBe(800_000n);
    expect(patched.markValue).toBe(1_000_000n); // prefer SDK mark
    expect(patched.unrealizedPnl).toBe(200_000n);
  });

  it('leaves intact when SDK costBasis already set', () => {
    const filled = { ...basePosition, costBasis: 900_000n, unrealizedPnl: 100_000n };
    const fills = [
      fill({
        id: '1',
        fillPrice: '400000',
        quantity: '2000000',
        timestamp: '100',
      }),
    ];
    expect(withRebuiltCostBasis(filled, ACCOUNT, fills)).toBe(filled);
  });

  it('leaves incomplete position unchanged when fills insufficient', () => {
    const patched = withRebuiltCostBasis(basePosition, ACCOUNT, []);
    expect(patched.costBasis).toBe(0n);
    expect(patched).toBe(basePosition);
  });
});
