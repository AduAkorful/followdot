import { describe, it, expect, vi } from 'vitest';
import { resolveClaimQuoteDecimals, resolveClaimQuoteDecimalsMap } from './claim-decimals';

function makeSdk(overrides: {
  quoteDecimals?: number | null;
  onchainDecimals?: number | null;
  tokenDecimals?: number | null;
  throwMarket?: boolean;
  throwOnchain?: boolean;
} = {}) {
  return {
    client: {
      getBinaryMarket: vi.fn(async () => {
        if (overrides.throwMarket) throw new Error('market missing');
        if (overrides.quoteDecimals == null) throw new Error('no quoteDecimals');
        return { quoteDecimals: overrides.quoteDecimals };
      }),
      getMarketOnchain: vi.fn(async () => {
        if (overrides.throwOnchain) throw new Error('onchain missing');
        return {
          decimals: overrides.onchainDecimals ?? 0,
          collateral: '0xcccccccccccccccccccccccccccccccccccccccc',
        };
      }),
      getErc20Metadata: vi.fn(async () => {
        if (overrides.tokenDecimals == null) throw new Error('no token');
        return { symbol: 'USDC', name: 'USD Coin', decimals: overrides.tokenDecimals };
      }),
    },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('resolveClaimQuoteDecimals', () => {
  it('prefers market.quoteDecimals', async () => {
    const sdk = makeSdk({ quoteDecimals: 18 });
    await expect(resolveClaimQuoteDecimals(sdk, '0xabc')).resolves.toBe(18);
  });

  it('falls back to on-chain market decimals', async () => {
    const sdk = makeSdk({ throwMarket: true, onchainDecimals: 6 });
    await expect(resolveClaimQuoteDecimals(sdk, '0xabc')).resolves.toBe(6);
  });

  it('falls back to ERC-20 token decimals', async () => {
    const sdk = makeSdk({
      throwMarket: true,
      onchainDecimals: -1,
      tokenDecimals: 18,
    });
    // onchain decimals invalid → token metadata
    sdk.client.getMarketOnchain = vi.fn(async () => ({
      decimals: Number.NaN,
      collateral: '0xcccccccccccccccccccccccccccccccccccccccc',
    }));
    await expect(resolveClaimQuoteDecimals(sdk, '0xabc')).resolves.toBe(18);
  });

  it('returns null instead of inventing 6', async () => {
    const sdk = makeSdk({ throwMarket: true, throwOnchain: true });
    await expect(resolveClaimQuoteDecimals(sdk, '0xabc')).resolves.toBeNull();
  });
});

describe('resolveClaimQuoteDecimalsMap', () => {
  it('dedupes market ids case-insensitively', async () => {
    const sdk = makeSdk({ quoteDecimals: 6 });
    const map = await resolveClaimQuoteDecimalsMap(sdk, ['0xAbC', '0xabc']);
    expect(map['0xabc']).toBe(6);
    expect(sdk.client.getBinaryMarket).toHaveBeenCalledTimes(1);
  });
});
