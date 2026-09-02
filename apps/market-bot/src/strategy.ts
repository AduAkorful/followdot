import type { BinarySide } from "@somnia-chain/markets-sdk";
import { formatUnits, parseUnits } from "viem";
import type { BotConfig } from "./config.js";
import type { MarketCandidate } from "./discovery.js";

export interface OrderPlan {
  side: BinarySide;
  amount: number;
  price: number;
  quantityRaw: bigint;
  notionalRaw: bigint;
}

export function buildOrderPlan(candidate: MarketCandidate, config: BotConfig): OrderPlan {
  const decimals = candidate.market.quoteDecimals;
  const baseDecimals = candidate.market.baseDecimals;
  const maxStakeRaw = parseUnits(config.maxOrderUsdc, decimals);
  const baseScale = 10n ** BigInt(baseDecimals);
  const quantityBeforeLot = (maxStakeRaw * baseScale) / candidate.ask.price;
  const quantityRaw = (quantityBeforeLot / candidate.params.lotSize) * candidate.params.lotSize;
  if (quantityRaw < candidate.params.minQuantity || quantityRaw <= 0n) {
    throw new Error("Configured order size is below the live market minimum quantity");
  }
  const notionalRaw = (quantityRaw * candidate.ask.price) / baseScale;
  if (notionalRaw <= 0n || notionalRaw > maxStakeRaw) {
    throw new Error("Calculated order notional exceeds the configured maximum");
  }

  return {
    side: config.strategySide,
    amount: Number(formatUnits(quantityRaw, baseDecimals)),
    price: Number(formatUnits(candidate.ask.price, decimals)),
    quantityRaw,
    notionalRaw,
  };
}

export function assertDailyLimit(dailyVolumeRaw: bigint, orderNotionalRaw: bigint, maxDailyRaw: bigint): void {
  if (dailyVolumeRaw + orderNotionalRaw > maxDailyRaw) {
    throw new Error("Configured daily notional limit would be exceeded");
  }
}
