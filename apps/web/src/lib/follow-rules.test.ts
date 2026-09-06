import { describe, expect, it } from 'vitest';
import {
  NO_WHALES_FOLLOWED_YET,
  countMonitoredWhales,
  loadFollowRules,
} from './follow-rules';
import type { AutoCopyRule } from '@/components/edit-rule-modal';

const sample = (addr: string): AutoCopyRule => ({
  whaleAddress: addr,
  maxStake: 10,
  slippageCap: 1,
  status: 'ACTIVE',
  autoRoll: false,
  cashOutTarget: 150,
  stopLossRounds: 3,
  maxRounds: 20,
  dailyCap: 100,
});

describe('loadFollowRules', () => {
  it('sync stub stays empty (async fetch is the real path)', () => {
    expect(loadFollowRules()).toEqual([]);
    expect(loadFollowRules('0xabc')).toEqual([]);
  });

  it('exposes honest empty copy', () => {
    expect(NO_WHALES_FOLLOWED_YET).toBe('No whales followed yet');
  });
});

describe('countMonitoredWhales', () => {
  it('counts distinct whales case-insensitively', () => {
    expect(countMonitoredWhales([])).toBe(0);
    expect(
      countMonitoredWhales([
        sample('0xAAA0000000000000000000000000000000000001'),
        sample('0xaaa0000000000000000000000000000000000001'),
        sample('0xBBB0000000000000000000000000000000000002'),
      ]),
    ).toBe(2);
  });
});
