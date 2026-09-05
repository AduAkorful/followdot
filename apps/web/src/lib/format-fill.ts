/**
 * Scale raw indexer fill ints using market quoteDecimals.
 * Never treat unscaled ints as dollars.
 */

export function scaleQuoteAmount(
  raw: string | number | null | undefined,
  quoteDecimals: number | null | undefined,
): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (quoteDecimals == null || !Number.isInteger(quoteDecimals) || quoteDecimals < 0) return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  return n / 10 ** quoteDecimals;
}

export function formatFillQuantity(
  raw: string | number | null | undefined,
  quoteDecimals: number | null | undefined,
): string {
  const value = scaleQuoteAmount(raw, quoteDecimals);
  return value === null ? '—' : value.toFixed(2);
}

export function formatFillPrice(
  raw: string | number | null | undefined,
  quoteDecimals: number | null | undefined,
): string {
  const value = scaleQuoteAmount(raw, quoteDecimals);
  return value === null ? '—' : `$${value.toFixed(4)}`;
}

export function resolveFillQuoteDecimals(
  marketId: string | null | undefined,
  marketPnL: Array<{ marketId: string; quoteDecimals?: number }>,
  extra?: Record<string, number> | null,
): number | undefined {
  if (!marketId) return undefined;
  const key = marketId.toLowerCase();
  const fromExtra = extra?.[key] ?? extra?.[marketId];
  if (Number.isInteger(fromExtra) && fromExtra! >= 0) return fromExtra;
  const row = marketPnL.find((m) => m.marketId.toLowerCase() === key);
  if (row && Number.isInteger(row.quoteDecimals) && row.quoteDecimals! >= 0) {
    return row.quoteDecimals;
  }
  return undefined;
}

export function formatClaimAmount(
  raw: bigint | string | number | null | undefined,
  quoteDecimals: number | null | undefined,
): string {
  const value = scaleQuoteAmount(
    typeof raw === 'bigint' ? raw.toString() : raw,
    quoteDecimals,
  );
  if (value === null) return '—';
  if (Math.abs(value) >= 1000) return `$${(value / 1000).toFixed(2)}k`;
  return `$${value.toFixed(2)}`;
}

export function scaleClaimAmount(
  raw: bigint | string | number | null | undefined,
  quoteDecimals: number | null | undefined,
): number | null {
  return scaleQuoteAmount(
    typeof raw === 'bigint' ? raw.toString() : raw,
    quoteDecimals,
  );
}
