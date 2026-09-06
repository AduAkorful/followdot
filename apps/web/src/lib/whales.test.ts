import { describe, it, expect } from 'vitest';
import {
  extractTopTraders,
  parseWhaleLeaderboardPayload,
  WHALE_LEADERBOARD_FRESH_MS,
  WHALE_LEADERBOARD_STALE_MS,
} from '@/lib/whales';
import type { FillRow } from '@somnia-chain/markets-sdk';

describe('extractTopTraders', () => {
  it('extracts unique trader addresses ranked by fill count', () => {
    const fills: FillRow[] = [
      { id: '1', market: '0x1', pool: '0x1', fillPrice: '0.5', quantity: '100', quoteQuantity: '50', maker: '0x' + 'a'.repeat(40), makerSide: 'BUY_YES', taker: '0x' + 'b'.repeat(40), takerSide: 'SELL_YES', kind: 'DIRECT_YES', takerIsBid: true, timestamp: '1000', txHash: '0xabc', takerOrder: null },
      { id: '2', market: '0x2', pool: '0x2', fillPrice: '0.5', quantity: '100', quoteQuantity: '50', maker: '0x' + 'a'.repeat(40), makerSide: 'BUY_YES', taker: '0x' + 'c'.repeat(40), takerSide: 'SELL_YES', kind: 'DIRECT_YES', takerIsBid: true, timestamp: '1001', txHash: '0xdef', takerOrder: null },
      { id: '3', market: '0x3', pool: '0x3', fillPrice: '0.5', quantity: '100', quoteQuantity: '50', maker: '0x' + 'b'.repeat(40), makerSide: 'BUY_YES', taker: '0x' + 'a'.repeat(40), takerSide: 'SELL_YES', kind: 'DIRECT_YES', takerIsBid: true, timestamp: '1002', txHash: '0x123', takerOrder: null },
    ];

    const result = extractTopTraders(fills);

    // 0xa... (2 fills as maker + 1 as taker = 3)
    // 0xb... (1 as maker + 1 as taker = 2)
    // 0xc... (1 as taker = 1)
    expect(result).toHaveLength(3);
    expect(result[0]).toBe('0x' + 'a'.repeat(40));
    expect(result[1]).toBe('0x' + 'b'.repeat(40));
    expect(result[2]).toBe('0x' + 'c'.repeat(40));
  });

  it('filters out invalid addresses', () => {
    const fills: FillRow[] = [
      { id: '1', market: '0x1', pool: '0x1', fillPrice: '0.5', quantity: '100', quoteQuantity: '50', maker: 'not-an-address', makerSide: null, taker: null, takerSide: null, kind: null, takerIsBid: null, timestamp: '1000', txHash: '0xabc', takerOrder: null },
      { id: '2', market: '0x2', pool: '0x2', fillPrice: '0.5', quantity: '100', quoteQuantity: '50', maker: '0x' + 'd'.repeat(40), makerSide: 'BUY_YES', taker: '0x' + 'e'.repeat(40), takerSide: 'SELL_YES', kind: 'DIRECT_YES', takerIsBid: true, timestamp: '1001', txHash: '0xdef', takerOrder: null },
    ];

    const result = extractTopTraders(fills);
    expect(result).toHaveLength(2);
    expect(result).not.toContain('not-an-address');
  });

  it('respects maxTraders limit', () => {
    const fills: FillRow[] = Array.from({ length: 30 }, (_, i) => ({
      id: String(i),
      market: '0x' + String(i).padStart(40, '0'),
      pool: '0x' + String(i).padStart(40, '0'),
      fillPrice: '0.5',
      quantity: '100',
      quoteQuantity: '50',
      maker: '0x' + String(i + 1).padStart(40, '0'),
      makerSide: 'BUY_YES',
      taker: '0x' + String(i + 2).padStart(40, '0'),
      takerSide: 'SELL_YES',
      kind: 'DIRECT_YES',
      takerIsBid: true,
      timestamp: String(i),
      txHash: '0x' + String(i),
      takerOrder: null,
    }));

    const result = extractTopTraders(fills, 5);
    expect(result).toHaveLength(5);
  });

  it('extracts addresses from takerOrder.owner', () => {
    const fills: FillRow[] = [
      { id: '1', market: '0x1', pool: '0x1', fillPrice: '0.5', quantity: '100', quoteQuantity: '50', maker: null, makerSide: null, taker: null, takerSide: 'BUY_YES', kind: 'DIRECT_YES', takerIsBid: true, timestamp: '1000', txHash: '0xabc', takerOrder: { owner: '0x' + 'f'.repeat(40), side: 'BUY_YES' } },
    ];

    const result = extractTopTraders(fills);
    expect(result).toContain('0x' + 'f'.repeat(40));
  });

  it('returns empty array for empty fills', () => {
    const result = extractTopTraders([]);
    expect(result).toEqual([]);
  });
});

describe('parseWhaleLeaderboardPayload', () => {
  it('passes through whales, count, and generatedAt', () => {
    const payload = parseWhaleLeaderboardPayload({
      whales: [{ address: '0xabc' }],
      count: 1,
      generatedAt: '2026-09-05T21:00:00.000Z',
    });
    expect(payload.whales).toHaveLength(1);
    expect(payload.count).toBe(1);
    expect(payload.generatedAt).toBe('2026-09-05T21:00:00.000Z');
  });

  it('defaults missing fields without inventing whales', () => {
    expect(parseWhaleLeaderboardPayload({})).toEqual({
      whales: [],
      count: 0,
      generatedAt: null,
    });
    expect(parseWhaleLeaderboardPayload(null).generatedAt).toBeNull();
    expect(parseWhaleLeaderboardPayload({ whales: [] }).generatedAt).toBeNull();
  });

  it('uses whales.length when count is absent', () => {
    const payload = parseWhaleLeaderboardPayload({ whales: [{}, {}] });
    expect(payload.count).toBe(2);
  });
});


describe("leaderboard cache windows", () => {
  it("keeps fresh window shorter than stale-while-revalidate window", () => {
    expect(WHALE_LEADERBOARD_FRESH_MS).toBe(30_000);
    expect(WHALE_LEADERBOARD_STALE_MS).toBeGreaterThan(WHALE_LEADERBOARD_FRESH_MS);
  });
});
