import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  defaultFollowRule,
  deleteFollowRule,
  listFollowRules,
  upsertFollowRule,
} from './follow-rules-store';

const WALLET = '0x' + 'a'.repeat(40);
const WHALE = '0x' + 'b'.repeat(40);
const WHALE2 = '0x' + 'c'.repeat(40);

describe('follow-rules-store', () => {
  let tmpFile: string;

  beforeEach(async () => {
    tmpFile = path.join(os.tmpdir(), `followdot-rules-${Date.now()}-${Math.random()}.json`);
  });

  afterEach(async () => {
    await fs.rm(tmpFile, { force: true }).catch(() => undefined);
    await fs.rm(`${tmpFile}.tmp`, { force: true }).catch(() => undefined);
  });

  it('persists and lists rules per wallet', async () => {
    const saved = await upsertFollowRule(WALLET, defaultFollowRule(WHALE), tmpFile);
    expect(saved.whaleAddress).toBe(WHALE.toLowerCase());
    expect(saved.status).toBe('ACTIVE');

    const listed = await listFollowRules(WALLET, tmpFile);
    expect(listed).toHaveLength(1);
    expect(listed[0].maxStake).toBe(10);
  });

  it('upserts by whale without duplicating', async () => {
    await upsertFollowRule(WALLET, defaultFollowRule(WHALE), tmpFile);
    await upsertFollowRule(
      WALLET,
      { ...defaultFollowRule(WHALE), maxStake: 25, status: 'PAUSED' },
      tmpFile,
    );
    const listed = await listFollowRules(WALLET, tmpFile);
    expect(listed).toHaveLength(1);
    expect(listed[0].maxStake).toBe(25);
    expect(listed[0].status).toBe('PAUSED');
  });

  it('deletes a whale rule', async () => {
    await upsertFollowRule(WALLET, defaultFollowRule(WHALE), tmpFile);
    await upsertFollowRule(WALLET, defaultFollowRule(WHALE2), tmpFile);
    expect(await deleteFollowRule(WALLET, WHALE, tmpFile)).toBe(true);
    const listed = await listFollowRules(WALLET, tmpFile);
    expect(listed).toHaveLength(1);
    expect(listed[0].whaleAddress).toBe(WHALE2.toLowerCase());
  });
});
