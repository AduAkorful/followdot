import type { BinarySide } from "@somnia-chain/markets-sdk";

const SIDES = ["BUY_YES", "BUY_NO"] as const satisfies readonly BinarySide[];

export type StrategySide = (typeof SIDES)[number];

export interface BotConfig {
  restUrl: string;
  wsUrl: string;
  privateKey?: `0x${string}`;
  maxOrderUsdc: string;
  maxDailyUsdc: string;
  minExpirySeconds: number;
  strategySide: StrategySide;
  stateFile: string;
  asset?: string;
  intervalSeconds?: number;
  minLiquidityUsdc?: string;
  maxSpreadBps: number;
  pollIntervalMs: number;
  fillTimeoutMs: number;
  checkOnly: boolean;
  continuous: boolean;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function positiveInteger(value: string, name: string): number {
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be a non-negative integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be greater than zero`);
  return parsed;
}

function nonNegativeInteger(value: string, name: string): number {
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be a non-negative integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${name} is too large`);
  return parsed;
}

function decimal(value: string, name: string): string {
  if (!/^\d+(?:\.\d+)?$/.test(value) || Number(value) <= 0) {
    throw new Error(`${name} must be a positive decimal amount`);
  }
  return value;
}

function booleanValue(value: string | undefined, name: string, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false`);
}

function side(value: string): StrategySide {
  if ((SIDES as readonly string[]).includes(value)) return value as StrategySide;
  throw new Error(`STRATEGY_SIDE must be one of ${SIDES.join(", ")}`);
}

function privateKey(value: string): `0x${string}` {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value) || /^0x0+$/.test(value)) {
    throw new Error("PRIVATE_KEY must be a non-zero 32-byte hex key");
  }
  return value as `0x${string}`;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BotConfig {
  const asset = env.ASSET?.trim();
  const interval = env.INTERVAL_SECONDS?.trim();
  const minLiquidity = env.MIN_LIQUIDITY_USDC?.trim();
  const checkOnly = booleanValue(env.CHECK_ONLY, "CHECK_ONLY", false);
  const continuous = booleanValue(env.CONTINUOUS, "CONTINUOUS", false);
  const runOnce = booleanValue(env.RUN_ONCE, "RUN_ONCE", !continuous);
  if (continuous === runOnce) {
    throw new Error("Set exactly one of RUN_ONCE=true or CONTINUOUS=true");
  }
  if (checkOnly && continuous) {
    throw new Error("CHECK_ONLY cannot be combined with CONTINUOUS");
  }
  const configuredKey = env.PRIVATE_KEY?.trim();
  if (!configuredKey && !checkOnly) required(env, "PRIVATE_KEY");

  return {
    restUrl: required(env, "DREAMDEX_REST_URL"),
    wsUrl: required(env, "DREAMDEX_WS_URL"),
    ...(configuredKey ? { privateKey: privateKey(configuredKey) } : {}),
    maxOrderUsdc: decimal(required(env, "MAX_ORDER_USDC"), "MAX_ORDER_USDC"),
    maxDailyUsdc: decimal(required(env, "MAX_DAILY_USDC"), "MAX_DAILY_USDC"),
    minExpirySeconds: positiveInteger(required(env, "MIN_EXPIRY_SECONDS"), "MIN_EXPIRY_SECONDS"),
    strategySide: side(required(env, "STRATEGY_SIDE")),
    stateFile: required(env, "BOT_STATE_FILE"),
    ...(asset ? { asset: asset.toUpperCase() } : {}),
    ...(interval ? { intervalSeconds: positiveInteger(interval, "INTERVAL_SECONDS") } : {}),
    ...(minLiquidity ? { minLiquidityUsdc: decimal(minLiquidity, "MIN_LIQUIDITY_USDC") } : {}),
    maxSpreadBps: nonNegativeInteger(required(env, "MAX_SPREAD_BPS"), "MAX_SPREAD_BPS"),
    pollIntervalMs: positiveInteger(required(env, "POLL_INTERVAL_MS"), "POLL_INTERVAL_MS"),
    fillTimeoutMs: positiveInteger(required(env, "FILL_TIMEOUT_MS"), "FILL_TIMEOUT_MS"),
    checkOnly,
    continuous,
  };
}

export { SIDES };
