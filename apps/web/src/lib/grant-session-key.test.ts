import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  classifySessionKeyError,
  generateEphemeralSessionKey,
  SESSION_SELECTORS,
  OPERATOR_REGISTRY_WRITE_ABI,
} from './grant-session-key';

describe('grant-session-key helpers', () => {
  it('generateEphemeralSessionKey returns address matching private key', () => {
    const a = generateEphemeralSessionKey();
    const b = generateEphemeralSessionKey();
    expect(a.privateKey).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(a.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(a.privateKey).not.toBe(b.privateKey);
    expect(a.address).not.toBe(b.address);
  });

  it('SESSION_SELECTORS is exactly place + cancel (one global grant tx)', () => {
    expect(SESSION_SELECTORS).toHaveLength(2);
    expect(SESSION_SELECTORS[0]).toMatch(/^0x[0-9a-fA-F]{8}$/);
    expect(SESSION_SELECTORS[1]).toMatch(/^0x[0-9a-fA-F]{8}$/);
    expect(SESSION_SELECTORS[0]).not.toBe(SESSION_SELECTORS[1]);
  });

  it('OPERATOR_REGISTRY_WRITE_ABI exposes setOperatorApprovalGlobal only', () => {
    const names = OPERATOR_REGISTRY_WRITE_ABI.map((item) =>
      'name' in item ? item.name : undefined,
    );
    expect(names).toContain('setOperatorApprovalGlobal');
    expect(names).toHaveLength(1);
  });

  it('classifySessionKeyError maps wallet rejection', () => {
    expect(classifySessionKeyError(new Error('User rejected the request'))).toMatch(/rejected/i);
  });

  it('classifySessionKeyError maps missing API', () => {
    expect(classifySessionKeyError(new Error('Authorization endpoint not available (404)'))).toMatch(
      /API is missing|404/i,
    );
  });

  it('classifySessionKeyError preserves durable-store misconfig messages', () => {
    const msg =
      'Session-key store has no durable backend on this host. Set KV_REST_API_URL + KV_REST_API_TOKEN';
    expect(classifySessionKeyError(new Error(msg))).toBe(msg);
  });

  it('classifySessionKeyError preserves partial on-chain registration failure', () => {
    const msg =
      'Registration failed (500). On-chain grant may have succeeded — check MetaMask activity.';
    expect(classifySessionKeyError(new Error(msg))).toBe(msg);
  });
});

describe('registerSessionKey / fetchSessionKeyStatus wallet headers', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('registerSessionKey POSTs with x-wallet-address and session material', async () => {
    const { registerSessionKey } = await import('./grant-session-key');
    const wallet = '0x' + 'a'.repeat(40);
    const session = '0x' + 'b'.repeat(40);
    const priv = '0x' + 'c'.repeat(64);

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({
        active: true,
        address: session,
        sessionAddress: session,
        grantTxHash: '0xdead',
        onChainGranted: true,
      }),
    });

    const result = await registerSessionKey(wallet, {
      walletAddress: wallet,
      sessionAddress: session,
      sessionKey: priv,
      grantTxHash: '0xdead',
      onChainGranted: true,
    });

    expect(result.active).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('/api/auth-session-key');
    expect(init.method).toBe('POST');
    expect(init.headers['x-wallet-address']).toBe(wallet);
    const body = JSON.parse(init.body);
    expect(body.walletAddress).toBe(wallet);
    expect(body.sessionAddress).toBe(session);
    expect(body.sessionKey).toBe(priv);
    expect(body.address).toBe(session);
    expect(body.privateKey).toBe(priv);
  });

  it('fetchSessionKeyStatus GETs with ?wallet= and x-wallet-address', async () => {
    const { fetchSessionKeyStatus } = await import('./grant-session-key');
    const wallet = '0x' + 'a'.repeat(40);

    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({
        active: false,
        sessionAddress: null,
        grantTxHash: null,
        onChainGranted: false,
      }),
    });

    await fetchSessionKeyStatus(wallet);
    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(`/api/auth-session-key?wallet=${encodeURIComponent(wallet)}`);
    expect(init.headers['x-wallet-address']).toBe(wallet);
  });

  it('setSessionOperatorApproval issues one writeContract with both selectors', async () => {
    const { setSessionOperatorApproval, SESSION_SELECTORS } = await import('./grant-session-key');
    const operator = ('0x' + 'b'.repeat(40)) as `0x${string}`;
    const writeContract = vi.fn().mockResolvedValue('0x' + 'd'.repeat(64));
    const walletClient = {
      account: { address: ('0x' + 'a'.repeat(40)) as `0x${string}` },
      chain: { id: 50312 },
      writeContract,
    };

    const hash = await setSessionOperatorApproval({
      walletClient: walletClient as never,
      operator,
      approved: true,
    });

    expect(hash).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(writeContract).toHaveBeenCalledTimes(1);
    const call = writeContract.mock.calls[0][0];
    expect(call.functionName).toBe('setOperatorApprovalGlobal');
    expect(call.args[0]).toBe(operator);
    expect(call.args[1]).toEqual([...SESSION_SELECTORS]);
    expect(call.args[2]).toBe(true);
  });
});
