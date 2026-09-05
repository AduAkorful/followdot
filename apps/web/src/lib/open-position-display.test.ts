import { describe, expect, it } from 'vitest';
import {
  exposureHumanFromOpenPosition,
  formatOpenPositionMoney,
  formatSharesHuman,
  mapHonestOpenPositionMoney,
} from './open-position-display';

const base = {
  balanceYes: 0n,
  balanceNo: 0n,
  costBasis: 0n,
  markValue: 0n,
  unrealizedPnl: 0n,
  market: { quoteDecimals: 6 },
};

describe('mapHonestOpenPositionMoney', () => {
  it('returns null for flat / dual-sided / bad decimals', () => {
    expect(mapHonestOpenPositionMoney(base)).toBeNull();
    expect(
      mapHonestOpenPositionMoney({
        ...base,
        balanceYes: 1_000_000n,
        balanceNo: 1_000_000n,
      }),
    ).toBeNull();
    expect(
      mapHonestOpenPositionMoney({
        ...base,
        balanceYes: 1_000_000n,
        market: { quoteDecimals: 1.5 },
      }),
    ).toBeNull();
  });

  it('keeps stake when costBasis is reconstructed', () => {
    const mapped = mapHonestOpenPositionMoney({
      ...base,
      balanceYes: 2_000_000n,
      costBasis: 1_200_000n,
      markValue: 1_500_000n,
      unrealizedPnl: 300_000n,
    });
    expect(mapped).toEqual({
      sharesHuman: 2,
      stakeHuman: 1.2,
      markHuman: 1.5,
      unrealizedPnlHuman: 0.3,
      costBasisUnknown: false,
    });
  });

  it('marks cost basis unknown when shares held but costBasis is 0', () => {
    const mapped = mapHonestOpenPositionMoney({
      ...base,
      balanceNo: 5_000_000n,
      costBasis: 0n,
      markValue: 2_500_000n,
      unrealizedPnl: 2_500_000n, // SDK: mark − 0
    });
    expect(mapped).toEqual({
      sharesHuman: 5,
      stakeHuman: null,
      markHuman: 2.5,
      unrealizedPnlHuman: null,
      costBasisUnknown: true,
    });
  });
});

describe('format helpers', () => {
  it('formats money with honest dash', () => {
    expect(formatOpenPositionMoney(null)).toBe('—');
    expect(formatOpenPositionMoney(1.2)).toBe('$1.20');
    expect(formatOpenPositionMoney(-0.5, { signed: true })).toBe('$-0.50');
    expect(formatOpenPositionMoney(0.5, { signed: true })).toBe('+$0.50');
    expect(formatSharesHuman(3.14159)).toBe('3.14');
  });
});

describe('exposureHumanFromOpenPosition', () => {
  it('uses cost basis when known', () => {
    expect(
      exposureHumanFromOpenPosition({
        ...base,
        balanceYes: 2_000_000n,
        costBasis: 1_200_000n,
        markValue: 9_000_000n,
        unrealizedPnl: 7_800_000n,
      }),
    ).toBe(1.2);
  });

  it('falls back to mark when cost basis incomplete', () => {
    expect(
      exposureHumanFromOpenPosition({
        ...base,
        balanceYes: 2_000_000n,
        costBasis: 0n,
        markValue: 1_100_000n,
        unrealizedPnl: 1_100_000n,
      }),
    ).toBe(1.1);
  });
});
