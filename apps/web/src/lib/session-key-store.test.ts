import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildFollowerRuleStub,
  deleteSessionKey,
  getSessionKey,
  putSessionKey,
  toPublicView,
} from './session-key-store';

const WALLET = '0x' + 'a'.repeat(40);
const SESSION = '0x' + 'b'.repeat(40);
const PRIV = '0x' + 'c'.repeat(64);

describe('session-key-store', () => {
  let tmpFile: string;

  beforeEach(async () => {
    tmpFile = path.join(os.tmpdir(), `followdot-session-${Date.now()}-${Math.random()}.json`);
  });

  afterEach(async () => {
    await fs.rm(tmpFile, { force: true }).catch(() => undefined);
    await fs.rm(`${tmpFile}.tmp`, { force: true }).catch(() => undefined);
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
    const pub = toPublicView(saved);
    expect(pub).not.toHaveProperty('sessionKey');
    expect(JSON.stringify(pub)).not.toContain(PRIV.slice(2));
    expect(pub.active).toBe(true);
    expect(pub.workerNote).toContain('SESSION_KEYS_KV');
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
});
