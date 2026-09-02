import type {
  BinaryMarket,
  BinaryOrderBook,
  BookLevel,
  MarketOnchain,
  SomniaMarkets,
} from "@somnia-chain/markets-sdk";
import { parseUnits } from "viem";
import type { BotConfig } from "./config.js";

export interface MarketCandidate {
  market: BinaryMarket;
  onchain: MarketOnchain;
  book: BinaryOrderBook;
  bid: BookLevel;
  ask: BookLevel;
  spreadBps: number;
  params: { tickSize: bigint; minQuantity: bigint; lotSize: bigint };
}

export class NoMarketAvailableError extends Error {
  constructor() {
    super("No live binary market passed the configured safety and liquidity checks");
    this.name = "NoMarketAvailableError";
  }
}

function booksForSide(book: BinaryOrderBook, side: BotConfig["strategySide"]): { bids: BookLevel[]; asks: BookLevel[] } {
  return side === "BUY_YES"
    ? { bids: book.yesBids, asks: book.yesAsks }
    : { bids: book.noBids, asks: book.noAsks };
}

function spreadBps(bid: BookLevel, ask: BookLevel): number {
  if (ask.price <= bid.price) return 0;
  return Number(((ask.price - bid.price) * 10_000n) / ask.price);
}

function liquidityRaw(level: BookLevel, amountDecimals: number): bigint {
  const amountScale = 10n ** BigInt(amountDecimals);
  return (level.price * level.quantity) / amountScale;
}

export async function discoverMarket(
  sdk: SomniaMarkets,
  config: BotConfig,
  nowSec = Math.floor(Date.now() / 1000),
  excludedMarketIds: ReadonlySet<string> = new Set(),
): Promise<MarketCandidate> {
  const markets = await sdk.client.listLiveBinaryMarkets({ status: "Trading", limit: 100 });
  const candidates: MarketCandidate[] = [];
  const minLiquidityByDecimals = new Map<number, bigint>();

  for (const market of markets) {
    if (excludedMarketIds.has(market.marketId)) continue;
    if (Number(market.expiry) <= nowSec + config.minExpirySeconds) continue;
    if (config.asset && market.asset.toUpperCase() !== config.asset) continue;
    if (config.intervalSeconds !== undefined && Number(market.intervalSec ?? "0") !== config.intervalSeconds) continue;

    const onchain = await sdk.client.getMarketOnchain(market.marketId);
    if (onchain.status !== 1 || onchain.isResolved || onchain.isVoided) continue;
    if (onchain.expiry <= BigInt(nowSec + config.minExpirySeconds)) continue;

    const params = await sdk.client.getBinaryBookParams(onchain.pool);
    const book = await sdk.client.getBinaryOrderBook(onchain.pool, {
      depth: 1,
      decimals: market.quoteDecimals,
    });
    const { bids, asks } = booksForSide(book, config.strategySide);
    const bid = bids[0];
    const ask = asks[0];
    if (!bid || !ask || ask.price <= 0n || ask.quantity <= 0n) continue;

    const currentSpreadBps = spreadBps(bid, ask);
    if (currentSpreadBps > config.maxSpreadBps) continue;

    if (config.minLiquidityUsdc) {
      let minimum = minLiquidityByDecimals.get(market.quoteDecimals);
      if (!minimum) {
        minimum = parseUnits(config.minLiquidityUsdc, market.quoteDecimals);
        minLiquidityByDecimals.set(market.quoteDecimals, minimum);
      }
      if (liquidityRaw(ask, market.baseDecimals) < minimum) continue;
    }

    candidates.push({ market, onchain, book, bid, ask, spreadBps: currentSpreadBps, params });
  }

  candidates.sort((a, b) => Number(a.market.expiry) - Number(b.market.expiry) || a.market.marketId.localeCompare(b.market.marketId));
  const selected = candidates[0];
  if (!selected) throw new NoMarketAvailableError();
  return selected;
}

export { booksForSide, spreadBps };
