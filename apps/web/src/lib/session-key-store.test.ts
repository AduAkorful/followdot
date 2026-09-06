import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildFollowerRuleStub,
  deleteSessionKey,
  durableBackendConfigured,
  getSessionKey,
  putSessionKey,
  resolveSessionKeyBackend,
  sessionKvKey,
  SessionKeyPersistError,
  toPublicView,
} from './session-key-store';

const WALLET = '0x' + 'a'.repeat(40);
const SESSION = '0x' + 'b'.repeat(40);
const PRIV = '0x' + 'c'.repeat(64);

describe('session-key-store (file backend)', () => {
  let tmpFile: string;
  const prevEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    tmpFile = path.join(os.tmpdir(), `followdot-session-${Date.now()}-${Math.random()}.json`);
    for (const k of [
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
    ]) {
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

  it('persists and loads a session key', async () => {
    const saved = await putSessionKey(
      {
        walletAddress: WALLET,
        sessionAddress: SESSION,
        sessionKey: PRIV,
        grantTxHash: '0xdead',
        onChainGranted: true,
      },
      tmpFile,
    );

    expect(saved.walletAddress).toBe(WALLET.toLowerCase());
    expect(saved.sessionAddress).toBe(SESSION.toLowerCase());
    expect(saved.sessionKey).toBe(PRIV.toLowerCase());
    expect(saved.onChainGranted).toBe(true);

    const loaded = await getSessionKey(WALLET, tmpFile);
    expect(loaded?.sessionAddress).toBe(SESSION.toLowerCase());
  });

  it('toPublicView never exposes the private key', async () => {
    const saved = await putSessionKey(
      {
        walletAddress: WALLET,
        sessionAddress: SESSION,
        sessionKey: PRIV,
        onChainGranted: true,
      },
      tmpFile,
    );
    const pub = toPublicView(saved, 'file');
    expect(pub).not.toHaveProperty('sessionKey');
    expect(JSON.stringify(pub)).not.toContain(PRIV.slice(2));
    expect(pub.active).toBe(true);
    expect(pub.workerNote).toContain('SESSION_KEYS_KV');
    expect(pub.storeBackend).toBe('file');
  });

  it('deleteSessionKey clears the record', async () => {
    await putSessionKey(
      {
        walletAddress: WALLET,
        sessionAddress: SESSION,
        sessionKey: PRIV,
        onChainGranted: false,
      },
      tmpFile,
    );
    expect(await deleteSessionKey(WALLET, tmpFile)).toBe(true);
    expect(await getSessionKey(WALLET, tmpFile)).toBeNull();
    expect(await deleteSessionKey(WALLET, tmpFile)).toBe(false);
  });

  it('rejects invalid addresses / keys', async () => {
    await expect(
      putSessionKey(
        {
          walletAddress: 'not-an-address',
          sessionAddress: SESSION,
          sessionKey: PRIV,
          onChainGranted: false,
        },
        tmpFile,
      ),
    ).rejects.toThrow(/walletAddress/i);
  });

  it('buildFollowerRuleStub matches AutoCopyRule shape fields', () => {
    const whale = '0x' + 'd'.repeat(40);
    const stub = buildFollowerRuleStub({
      walletAddress: WALLET,
      whaleAddress: whale,
      sessionKey: PRIV,
      bankrollCap: 100,
    });
    expect(stub.walletAddress).toBe(WALLET.toLowerCase());
    expect(stub.whaleAddress).toBe(whale.toLowerCase());
    expect(stub.sessionKey).toBe(PRIV.toLowerCase());
    expect(stub.status).toBe('PAUSED');
    expect(stub.guardrails).toBeDefined();
  });

  it('sessionKvKey is web:session:{wallet}', () => {
    expect(sessionKvKey(WALLET)).toBe(`web:session:${WALLET.toLowerCase()}`);
  });

  it('on Vercel without durable KV, putSessionKey fails honestly (no silent file)', async () => {
    process.env.VERCEL = '1';
    expect(resolveSessionKeyBackend()).toBe('file');
    expect(durableBackendConfigured()).toBe(false);
    await expect(
      putSessionKey({
        walletAddress: WALLET,
        sessionAddress: SESSION,
        sessionKey: PRIV,
        onChainGranted: true,
      }),
    ).rejects.toBeInstanceOf(SessionKeyPersistError);
    await expect(
      putSessionKey({
        walletAddress: WALLET,
        sessionAddress: SESSION,
        sessionKey: PRIV,
        onChainGranted: true,
      }),
    ).rejects.toThrow(/durable backend/i);
  });
});

describe('session-key-store (upstash backend)', () => {
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

  it('resolveSessionKeyBackend prefers upstash when KV_REST_* set', () => {
    expect(resolveSessionKeyBackend()).toBe('upstash');
    expect(durableBackendConfigured()).toBe(true);
  });

  it('putSessionKey SETs web:session key via Upstash REST', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: null }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: 'OK' }),
      });

    const saved = await putSessionKey({
      walletAddress: WALLET,
      sessionAddress: SESSION,
      sessionKey: PRIV,
      grantTxHash: '0xdead',
      onChainGranted: true,
    });

    expect(saved.sessionAddress).toBe(SESSION.toLowerCase());
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    const [, setInit] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[1];
    const cmd = JSON.parse(setInit.body);
    expect(cmd[0]).toBe('SET');
    expect(cmd[1]).toBe(sessionKvKey(WALLET));
    expect(JSON.parse(cmd[2]).sessionKey).toBe(PRIV.toLowerCase());
  });

  it('getSessionKey GETs and parses JSON payload', async () => {
    const record = {
      walletAddress: WALLET.toLowerCase(),
      sessionAddress: SESSION.toLowerCase(),
      sessionKey: PRIV.toLowerCase(),
      grantTxHash: '0xdead',
      onChainGranted: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ result: JSON.stringify(record) }),
    });

    const loaded = await getSessionKey(WALLET);
    expect(loaded?.sessionAddress).toBe(SESSION.toLowerCase());
    expect(loaded?.onChainGranted).toBe(true);
  });
});
