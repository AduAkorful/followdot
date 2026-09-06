import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  defaultFollowRule,
  deleteFollowRule,
  FollowRulesPersistError,
  followRulesKvKey,
  listFollowRules,
  resolveFollowRulesBackend,
  upsertFollowRule,
} from './follow-rules-store';
import { durableBackendConfigured } from './session-key-store';

const WALLET = '0x' + 'a'.repeat(40);
const WHALE = '0x' + 'b'.repeat(40);
const WHALE2 = '0x' + 'c'.repeat(40);

const KV_ENV_KEYS = [
  'VERCEL',
  'NEXT_PUBLIC_VERCEL_ENV',
  'KV_REST_API_URL',
  'KV_REST_API_TOKEN',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'CF_ACCOUNT_ID',
  'CF_API_TOKEN',
  'CLOUDFLARE_API_TOKEN',
  'CF_KV_NAMESPACE_ID',
  'SESSION_KEYS_KV_NAMESPACE_ID',
  'CF_SESSION_KEYS_KV_ID',
] as const;

describe('follow-rules-store (file backend)', () => {
  let tmpFile: string;
  const prevEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    tmpFile = path.join(os.tmpdir(), `followdot-rules-${Date.now()}-${Math.random()}.json`);
    for (const k of KV_ENV_KEYS) {
      prevEnv[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(async () => {
    await fs.rm(tmpFile, { force: true }).catch(() => undefined);
    await fs.rm(`${tmpFile}.tmp`, { force: true }).catch(() => undefined);
    for (const [k, v] of Object.entries(prevEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
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

  it('followRulesKvKey is web:follow-rules:{wallet}', () => {
    expect(followRulesKvKey(WALLET)).toBe(`web:follow-rules:${WALLET.toLowerCase()}`);
  });

  it('on Vercel without durable KV, upsertFollowRule fails honestly (no silent file)', async () => {
    process.env.VERCEL = '1';
    expect(resolveFollowRulesBackend()).toBe('file');
    expect(durableBackendConfigured()).toBe(false);
    await expect(
      upsertFollowRule(WALLET, defaultFollowRule(WHALE)),
    ).rejects.toBeInstanceOf(FollowRulesPersistError);
    await expect(
      upsertFollowRule(WALLET, defaultFollowRule(WHALE)),
    ).rejects.toThrow(/durable backend/i);
  });
});

describe('follow-rules-store (upstash backend)', () => {
  const prevEnv: Record<string, string | undefined> = {};
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    for (const k of [
      'VERCEL',
      'KV_REST_API_URL',
      'KV_REST_API_TOKEN',
      'UPSTASH_REDIS_REST_URL',
      'UPSTASH_REDIS_REST_TOKEN',
      'CF_ACCOUNT_ID',
      'CF_API_TOKEN',
      'CF_KV_NAMESPACE_ID',
    ]) {
      prevEnv[k] = process.env[k];
      delete process.env[k];
    }
    process.env.KV_REST_API_URL = 'https://example-kv.upstash.io';
    process.env.KV_REST_API_TOKEN = 'test-token';
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    for (const [k, v] of Object.entries(prevEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('resolveFollowRulesBackend prefers upstash when KV_REST_* set', () => {
    expect(resolveFollowRulesBackend()).toBe('upstash');
    expect(durableBackendConfigured()).toBe(true);
  });

  it('upsertFollowRule SETs web:follow-rules key via Upstash REST', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: null }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: 'OK' }),
      });

    const saved = await upsertFollowRule(WALLET, defaultFollowRule(WHALE));

    expect(saved.whaleAddress).toBe(WHALE.toLowerCase());
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    const [, setInit] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[1];
    const cmd = JSON.parse(setInit.body);
    expect(cmd[0]).toBe('SET');
    expect(cmd[1]).toBe(followRulesKvKey(WALLET));
    const rules = JSON.parse(cmd[2]);
    expect(Array.isArray(rules)).toBe(true);
    expect(rules[0].whaleAddress).toBe(WHALE.toLowerCase());
    expect(rules[0].maxStake).toBe(10);
  });

  it('listFollowRules GETs and parses JSON array payload', async () => {
    const rules = [
      {
        ...defaultFollowRule(WHALE),
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ];
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ result: JSON.stringify(rules) }),
    });

    const listed = await listFollowRules(WALLET);
    expect(listed).toHaveLength(1);
    expect(listed[0].whaleAddress).toBe(WHALE.toLowerCase());
  });

  it('deleteFollowRule filters then SETs remaining rules', async () => {
    const existing = [
      {
        ...defaultFollowRule(WHALE),
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        ...defaultFollowRule(WHALE2),
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ];
    (globalThis.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: JSON.stringify(existing) }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: 'OK' }),
      });

    expect(await deleteFollowRule(WALLET, WHALE)).toBe(true);
    const [, setInit] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[1];
    const cmd = JSON.parse(setInit.body);
    expect(cmd[0]).toBe('SET');
    const next = JSON.parse(cmd[2]);
    expect(next).toHaveLength(1);
    expect(next[0].whaleAddress).toBe(WHALE2.toLowerCase());
  });
});
