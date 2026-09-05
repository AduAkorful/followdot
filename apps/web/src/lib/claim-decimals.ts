/**
 * Resolve collateral/outcome decimals for claimable payout formatting.
 * Prefer market.quoteDecimals; else on-chain market decimals; else ERC-20 metadata.
 * Never invent 6 when the SDK can supply a real scale.
 */
import type { SomniaMarkets } from '@somnia-chain/markets-sdk';
import type { Hex, Address } from 'viem';

export async function resolveClaimQuoteDecimals(
  sdk: SomniaMarkets,
  marketId: string,
): Promise<number | null> {
  try {
    const market = await sdk.client.getBinaryMarket(marketId as Hex);
    if (
      market &&
      Number.isInteger(market.quoteDecimals) &&
      market.quoteDecimals >= 0
    ) {
      return market.quoteDecimals;
    }
  } catch {
    // fall through to on-chain / token metadata
  }

  try {
    const onchain = await sdk.client.getMarketOnchain(marketId as Hex);
    if (onchain && Number.isInteger(onchain.decimals) && onchain.decimals >= 0) {
      return onchain.decimals;
    }
    if (onchain?.collateral) {
      const meta = await sdk.client.getErc20Metadata(onchain.collateral as Address);
      if (meta && Number.isInteger(meta.decimals) && meta.decimals >= 0) {
        return meta.decimals;
      }
    }
  } catch {
    // unavailable — caller must not assume 6
  }

  return null;
}

/** Cache decimals per marketId for a batch of claimables. */
export async function resolveClaimQuoteDecimalsMap(
  sdk: SomniaMarkets,
  marketIds: string[],
): Promise<Record<string, number | null>> {
  const unique = [...new Set(marketIds.map((id) => id.toLowerCase()))];
  const entries = await Promise.all(
    unique.map(async (id) => {
      const decimals = await resolveClaimQuoteDecimals(sdk, id);
      return [id, decimals] as const;
    }),
  );
  return Object.fromEntries(entries);
}
