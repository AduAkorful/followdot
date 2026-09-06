/**
 * Persistence for DreamDEX session-key material (Settings authorize / revoke).
 *
 * Backends (first match wins):
 * 1. Upstash / Vercel KV REST — KV_REST_API_URL+KV_REST_API_TOKEN
 *    or UPSTASH_REDIS_REST_URL+UPSTASH_REDIS_REST_TOKEN
 * 2. Cloudflare KV REST — CF_ACCOUNT_ID + CF_API_TOKEN +
 *    (CF_KV_NAMESPACE_ID | SESSION_KEYS_KV_NAMESPACE_ID)
 *    (same namespace as autocopy wrangler SESSION_KEYS_KV is fine;
 *     web keys use `web:session:{wallet}` and do not collide with
 *     `follower:{wallet}:{whale}`).
 * 3. Local file — `.data/session-keys.json` (or FOLLOWDOT_SESSION_KEYS_PATH)
 *    for Next.js on a writable disk (local `next dev` / long-lived Node).
 *
 * On Vercel serverless the file backend is ephemeral / read-only across
 * instances. Without a durable backend, PUT/DELETE fail with a clear error
 * so Settings never silently shows "No Active Session" after a chain grant.
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
  /** Which persistence backend served this record (or would serve writes). */
  storeBackend?: SessionKeyBackendKind;
}

export type SessionKeyBackendKind = "upstash" | "cloudflare-kv" | "file";

export class SessionKeyPersistError extends Error {
  readonly code = "SESSION_KEY_PERSIST" as const;
  constructor(message: string) {
    super(message);
    this.name = "SessionKeyPersistError";
  }
}

const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;
const KEY_RE = /^0x[a-fA-F0-9]{64}$/;

/** KV key for Settings session material (distinct from autocopy follower rules). */
export function sessionKvKey(walletAddress: string): string {
  return `web:session:${normalizeAddress(walletAddress)}`;
}

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

/** Exported for API inactive-payload messaging. */
export function isVercelRuntimeHint(): boolean {
  return Boolean(process.env.VERCEL) || process.env.NEXT_PUBLIC_VERCEL_ENV != null;
}

function isVercelRuntime(): boolean {
  return isVercelRuntimeHint();
}

function upstashEnv(): { url: string; token: string } | null {
  const url =
    process.env.KV_REST_API_URL?.trim() ||
    process.env.UPSTASH_REDIS_REST_URL?.trim() ||
    "";
  const token =
    process.env.KV_REST_API_TOKEN?.trim() ||
    process.env.UPSTASH_REDIS_REST_TOKEN?.trim() ||
    "";
  if (!url || !token) return null;
  return { url: url.replace(/\/$/, ""), token };
}

function cloudflareKvEnv(): {
  accountId: string;
  apiToken: string;
  namespaceId: string;
} | null {
  const accountId = process.env.CF_ACCOUNT_ID?.trim() || "";
  const apiToken =
    process.env.CF_API_TOKEN?.trim() ||
    process.env.CLOUDFLARE_API_TOKEN?.trim() ||
    "";
  const namespaceId =
    process.env.CF_KV_NAMESPACE_ID?.trim() ||
    process.env.SESSION_KEYS_KV_NAMESPACE_ID?.trim() ||
    process.env.CF_SESSION_KEYS_KV_ID?.trim() ||
    "";
  if (!accountId || !apiToken || !namespaceId) return null;
  return { accountId, apiToken, namespaceId };
}

/**
 * Resolve which backend writes/reads will use.
 * Explicit `filePath` (tests / FOLLOWDOT_SESSION_KEYS_PATH callers) forces file.
 */
export function resolveSessionKeyBackend(opts?: {
  filePath?: string;
}): SessionKeyBackendKind {
  if (opts?.filePath) return "file";
  if (upstashEnv()) return "upstash";
  if (cloudflareKvEnv()) return "cloudflare-kv";
  return "file";
}

export function durableBackendConfigured(): boolean {
  return upstashEnv() != null || cloudflareKvEnv() != null;
}

function missingDurableBackendMessage(): string {
  return (
    "Session-key store has no durable backend on this host. " +
    "Set KV_REST_API_URL + KV_REST_API_TOKEN (Vercel/Upstash KV) or " +
    "CF_ACCOUNT_ID + CF_API_TOKEN + CF_KV_NAMESPACE_ID " +
    "(Cloudflare KV REST; use autocopy wrangler SESSION_KEYS_KV id). " +
    "Local .data/session-keys.json is not shared across Vercel serverless instances — " +
    "POST would appear to succeed then GET returns active:false."
  );
}

function assertWritableBackend(
  kind: SessionKeyBackendKind,
  opts?: { filePath?: string },
): void {
  // Explicit filePath (tests / FOLLOWDOT_SESSION_KEYS_PATH override) always allowed.
  if (opts?.filePath) return;
  if (kind === "file" && isVercelRuntime() && !durableBackendConfigured()) {
    throw new SessionKeyPersistError(missingDurableBackendMessage());
  }
}

function workerNote(wallet: string, backend: SessionKeyBackendKind): string {
  if (backend === "file") {
    return (
      `Local file store only (${defaultStorePath()}). Sync the private key into autocopy SESSION_KEYS_KV as ` +
      `follower:${wallet.toLowerCase()}:{whaleAddress} with AutoCopyRule.sessionKey set, ` +
      `or auto-copy will not fire. Revoke clears this local record.`
    );
  }
  if (backend === "upstash") {
    return (
      `Persisted in Upstash/Vercel KV (web:session:{wallet}). Still sync AutoCopyRule.sessionKey into ` +
      `autocopy SESSION_KEYS_KV as follower:${wallet.toLowerCase()}:{whaleAddress} for the worker, ` +
      `or auto-copy will not fire.`
    );
  }
  return (
    `Persisted in Cloudflare KV (web:session:{wallet}). Autocopy follower rules still need ` +
    `follower:${wallet.toLowerCase()}:{whaleAddress} with AutoCopyRule.sessionKey set in SESSION_KEYS_KV.`
  );
}

export function toPublicView(
  record: StoredSessionKey,
  backend: SessionKeyBackendKind = resolveSessionKeyBackend(),
): SessionKeyPublicView {
  return {
    active: true,
    walletAddress: record.walletAddress,
    sessionAddress: record.sessionAddress,
    grantTxHash: record.grantTxHash,
    onChainGranted: record.onChainGranted,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    workerNote: workerNote(record.walletAddress, backend),
    storeBackend: backend,
  };
}

type StoreFile = Record<string, StoredSessionKey>;

async function readFileStore(filePath: string): Promise<StoreFile> {
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

async function writeFileStore(data: StoreFile, filePath: string): Promise<void> {
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    await fs.rename(tmp, filePath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EROFS" || code === "EACCES" || code === "EPERM") {
      throw new SessionKeyPersistError(
        `${missingDurableBackendMessage()} (filesystem write failed: ${code}).`,
      );
    }
    throw err;
  }
}

async function upstashCommand(
  env: { url: string; token: string },
  command: unknown[],
): Promise<unknown> {
  const res = await fetch(env.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new SessionKeyPersistError(
      `Upstash/Vercel KV ${command[0]} failed (${res.status}): ${text.slice(0, 200) || res.statusText}`,
    );
  }
  const json = (await res.json()) as { result?: unknown; error?: string };
  if (json.error) {
    throw new SessionKeyPersistError(`Upstash/Vercel KV error: ${json.error}`);
  }
  return json.result;
}

async function cfKvUrl(key: string): Promise<{
  url: string;
  headers: Record<string, string>;
}> {
  const env = cloudflareKvEnv();
  if (!env) {
    throw new SessionKeyPersistError(missingDurableBackendMessage());
  }
  const encoded = encodeURIComponent(key);
  return {
    url: `https://api.cloudflare.com/client/v4/accounts/${env.accountId}/storage/kv/namespaces/${env.namespaceId}/values/${encoded}`,
    headers: { Authorization: `Bearer ${env.apiToken}` },
  };
}

async function getFromUpstash(wallet: string): Promise<StoredSessionKey | null> {
  const env = upstashEnv();
  if (!env) return null;
  const result = await upstashCommand(env, ["GET", sessionKvKey(wallet)]);
  if (result == null || result === "") return null;
  if (typeof result !== "string") {
    throw new SessionKeyPersistError("Upstash/Vercel KV returned non-string session payload");
  }
  return JSON.parse(result) as StoredSessionKey;
}

async function putToUpstash(record: StoredSessionKey): Promise<void> {
  const env = upstashEnv();
  if (!env) throw new SessionKeyPersistError(missingDurableBackendMessage());
  await upstashCommand(env, ["SET", sessionKvKey(record.walletAddress), JSON.stringify(record)]);
}

async function deleteFromUpstash(wallet: string): Promise<boolean> {
  const env = upstashEnv();
  if (!env) throw new SessionKeyPersistError(missingDurableBackendMessage());
  const result = await upstashCommand(env, ["DEL", sessionKvKey(wallet)]);
  return Number(result) > 0;
}

async function getFromCloudflare(wallet: string): Promise<StoredSessionKey | null> {
  const { url, headers } = await cfKvUrl(sessionKvKey(wallet));
  const res = await fetch(url, { headers });
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new SessionKeyPersistError(
      `Cloudflare KV GET failed (${res.status}): ${text.slice(0, 200) || res.statusText}`,
    );
  }
  const raw = await res.text();
  if (!raw) return null;
  return JSON.parse(raw) as StoredSessionKey;
}

async function putToCloudflare(record: StoredSessionKey): Promise<void> {
  const { url, headers } = await cfKvUrl(sessionKvKey(record.walletAddress));
  const res = await fetch(url, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(record),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new SessionKeyPersistError(
      `Cloudflare KV PUT failed (${res.status}): ${text.slice(0, 200) || res.statusText}`,
    );
  }
}

async function deleteFromCloudflare(wallet: string): Promise<boolean> {
  const { url, headers } = await cfKvUrl(sessionKvKey(wallet));
  const res = await fetch(url, { method: "DELETE", headers });
  if (res.status === 404) return false;
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new SessionKeyPersistError(
      `Cloudflare KV DELETE failed (${res.status}): ${text.slice(0, 200) || res.statusText}`,
    );
  }
  return true;
}

export async function getSessionKey(
  walletAddress: string,
  filePath?: string,
): Promise<StoredSessionKey | null> {
  if (!isAddress(walletAddress)) return null;
  const backend = resolveSessionKeyBackend({ filePath });

  if (backend === "upstash") {
    return getFromUpstash(walletAddress);
  }
  if (backend === "cloudflare-kv") {
    return getFromCloudflare(walletAddress);
  }

  const store = await readFileStore(filePath ?? defaultStorePath());
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
  filePath?: string,
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

  const backend = resolveSessionKeyBackend({ filePath });
  assertWritableBackend(backend, { filePath });

  const now = new Date().toISOString();
  const key = normalizeAddress(input.walletAddress);
  const prev = await getSessionKey(input.walletAddress, filePath);
  const record: StoredSessionKey = {
    walletAddress: key,
    sessionAddress: normalizeAddress(input.sessionAddress),
    sessionKey: input.sessionKey.toLowerCase(),
    grantTxHash: input.grantTxHash ?? null,
    onChainGranted: input.onChainGranted,
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
  };

  if (backend === "upstash") {
    await putToUpstash(record);
    return record;
  }
  if (backend === "cloudflare-kv") {
    await putToCloudflare(record);
    return record;
  }

  const pathToUse = filePath ?? defaultStorePath();
  const store = await readFileStore(pathToUse);
  store[key] = record;
  await writeFileStore(store, pathToUse);
  return record;
}

export async function deleteSessionKey(
  walletAddress: string,
  filePath?: string,
): Promise<boolean> {
  if (!isAddress(walletAddress)) return false;
  const backend = resolveSessionKeyBackend({ filePath });
  assertWritableBackend(backend, { filePath });

  if (backend === "upstash") {
    return deleteFromUpstash(walletAddress);
  }
  if (backend === "cloudflare-kv") {
    return deleteFromCloudflare(walletAddress);
  }

  const pathToUse = filePath ?? defaultStorePath();
  const key = normalizeAddress(walletAddress);
  const store = await readFileStore(pathToUse);
  if (!(key in store)) return false;
  delete store[key];
  await writeFileStore(store, pathToUse);
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
