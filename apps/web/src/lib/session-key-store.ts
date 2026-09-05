/**
 * Local/dev persistence for DreamDEX session-key material.
 *
 * Autocopy worker reads Cloudflare `SESSION_KEYS_KV` with keys shaped like
 * `follower:{wallet}:{whale}` (see `@followdot/sdk-helpers` AutoCopyRule).
 * The Next.js app cannot write that KV from localhost, so we persist here under
 * `.data/session-keys.json` (gitignored) and surface a clear sync note in the UI.
 *
 * NEVER return `sessionKey` (private key) from public GET responses.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

export interface StoredSessionKey {
  walletAddress: string;
  /** Ephemeral operator address (public). */
  sessionAddress: string;
  /** Ephemeral private key — worker uses this as AutoCopyRule.sessionKey. */
  sessionKey: string;
  grantTxHash: string | null;
  onChainGranted: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SessionKeyPublicView {
  active: boolean;
  walletAddress: string;
  sessionAddress: string;
  grantTxHash: string | null;
  onChainGranted: boolean;
  createdAt: string;
  updatedAt: string;
  /** Honest ops note for local QA / worker wiring. */
  workerNote: string;
}

const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;
const KEY_RE = /^0x[a-fA-F0-9]{64}$/;

export function isAddress(value: string): boolean {
  return ADDR_RE.test(value);
}

export function isPrivateKey(value: string): boolean {
  return KEY_RE.test(value);
}

export function normalizeAddress(value: string): string {
  return value.toLowerCase();
}

function defaultStorePath(): string {
  return (
    process.env.FOLLOWDOT_SESSION_KEYS_PATH?.trim() ||
    path.join(process.cwd(), ".data", "session-keys.json")
  );
}

function workerNote(wallet: string): string {
  return (
    `Local store only. Sync the private key into autocopy SESSION_KEYS_KV as ` +
    `follower:${wallet.toLowerCase()}:{whaleAddress} with AutoCopyRule.sessionKey set, ` +
    `or auto-copy will not fire. Revoke clears this local record.`
  );
}

export function toPublicView(record: StoredSessionKey): SessionKeyPublicView {
  return {
    active: true,
    walletAddress: record.walletAddress,
    sessionAddress: record.sessionAddress,
    grantTxHash: record.grantTxHash,
    onChainGranted: record.onChainGranted,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    workerNote: workerNote(record.walletAddress),
  };
}

type StoreFile = Record<string, StoredSessionKey>;

async function readStore(filePath = defaultStorePath()): Promise<StoreFile> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as StoreFile;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return {};
    throw err;
  }
}

async function writeStore(data: StoreFile, filePath = defaultStorePath()): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  await fs.rename(tmp, filePath);
}

export async function getSessionKey(
  walletAddress: string,
  filePath = defaultStorePath(),
): Promise<StoredSessionKey | null> {
  if (!isAddress(walletAddress)) return null;
  const store = await readStore(filePath);
  return store[normalizeAddress(walletAddress)] ?? null;
}

export async function putSessionKey(
  input: {
    walletAddress: string;
    sessionAddress: string;
    sessionKey: string;
    grantTxHash?: string | null;
    onChainGranted: boolean;
  },
  filePath = defaultStorePath(),
): Promise<StoredSessionKey> {
  if (!isAddress(input.walletAddress)) {
    throw new Error("Invalid walletAddress");
  }
  if (!isAddress(input.sessionAddress)) {
    throw new Error("Invalid sessionAddress");
  }
  if (!isPrivateKey(input.sessionKey)) {
    throw new Error("Invalid sessionKey");
  }

  const now = new Date().toISOString();
  const key = normalizeAddress(input.walletAddress);
  const store = await readStore(filePath);
  const prev = store[key];
  const record: StoredSessionKey = {
    walletAddress: key,
    sessionAddress: normalizeAddress(input.sessionAddress),
    sessionKey: input.sessionKey.toLowerCase(),
    grantTxHash: input.grantTxHash ?? null,
    onChainGranted: input.onChainGranted,
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
  };
  store[key] = record;
  await writeStore(store, filePath);
  return record;
}

export async function deleteSessionKey(
  walletAddress: string,
  filePath = defaultStorePath(),
): Promise<boolean> {
  if (!isAddress(walletAddress)) return false;
  const key = normalizeAddress(walletAddress);
  const store = await readStore(filePath);
  if (!(key in store)) return false;
  delete store[key];
  await writeStore(store, filePath);
  return true;
}

/**
 * Build a minimal AutoCopyRule-compatible stub for a known whale.
 * Used when exporting local session material toward SESSION_KEYS_KV.
 */
export function buildFollowerRuleStub(opts: {
  walletAddress: string;
  whaleAddress: string;
  sessionKey: string;
  bankrollCap?: number;
}): Record<string, unknown> {
  const dayKey = new Date().toISOString().slice(0, 10);
  return {
    walletAddress: normalizeAddress(opts.walletAddress),
    whaleAddress: normalizeAddress(opts.whaleAddress),
    sessionKey: opts.sessionKey.toLowerCase(),
    bankrollCap: opts.bankrollCap ?? 0,
    autoRoll: false,
    guardrails: {
      cashOutTarget: 150,
      stopLossRounds: 3,
      maxRounds: 20,
      dailyCap: "0",
    },
    dailyVolume: "0",
    dayKey,
    consecutiveLosses: 0,
    roundsToday: 0,
    lastFillId: null,
    status: "PAUSED",
  };
}
