/**
 * Persistence for Auto-Follow / Settings follow rules.
 *
 * Backends (first match wins) — same pattern as session-key-store:
 * 1. Upstash / Vercel KV REST — KV_REST_API_URL+KV_REST_API_TOKEN
 *    or UPSTASH_REDIS_REST_URL+UPSTASH_REDIS_REST_TOKEN
 * 2. Cloudflare KV REST — CF_ACCOUNT_ID + CF_API_TOKEN +
 *    (CF_KV_NAMESPACE_ID | SESSION_KEYS_KV_NAMESPACE_ID)
 *    Keys use `web:follow-rules:{wallet}` and do not collide with
 *    `web:session:{wallet}` or `follower:{wallet}:{whale}`.
 * 3. Local file — `.data/follow-rules.json` (or FOLLOWDOT_FOLLOW_RULES_PATH)
 *    for Next.js on a writable disk (local `next dev` / long-lived Node).
 *
 * On Vercel serverless the file backend is ephemeral / read-only across
 * instances. Without a durable backend, POST/DELETE fail with a clear error
 * so Auto-Follow never surfaces raw ENOENT from mkdir `/var/task/.../.data`.
 *
 * UI AutoCopyRule shape (edit-rule-modal) — not the worker AutoCopyRule that
 * also carries sessionKey / dailyVolume. Worker SESSION_KEYS_KV sync remains
 * a separate ops step after session-key authorize.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import type { AutoCopyRule } from "@/components/edit-rule-modal";
import {
  durableBackendConfigured,
  isVercelRuntimeHint,
} from "@/lib/session-key-store";

export type StoredFollowRule = AutoCopyRule & {
  createdAt: string;
  updatedAt: string;
};

export type FollowRulesBackendKind = "upstash" | "cloudflare-kv" | "file";

export class FollowRulesPersistError extends Error {
  readonly code = "FOLLOW_RULES_PERSIST" as const;
  constructor(message: string) {
    super(message);
    this.name = "FollowRulesPersistError";
  }
}

const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;

/** KV key for a follower wallet's rule list. */
export function followRulesKvKey(walletAddress: string): string {
  return `web:follow-rules:${normalizeAddress(walletAddress)}`;
}

export function isAddress(value: string): boolean {
  return ADDR_RE.test(value);
}

export function normalizeAddress(value: string): string {
  return value.toLowerCase();
}

function defaultStorePath(): string {
  return (
    process.env.FOLLOWDOT_FOLLOW_RULES_PATH?.trim() ||
    path.join(process.cwd(), ".data", "follow-rules.json")
  );
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
 * Explicit `filePath` (tests / FOLLOWDOT_FOLLOW_RULES_PATH callers) forces file.
 */
export function resolveFollowRulesBackend(opts?: {
  filePath?: string;
}): FollowRulesBackendKind {
  if (opts?.filePath) return "file";
  if (upstashEnv()) return "upstash";
  if (cloudflareKvEnv()) return "cloudflare-kv";
  return "file";
}

function missingDurableBackendMessage(): string {
  return (
    "Follow-rules store has no durable backend on this host. " +
    "Set KV_REST_API_URL + KV_REST_API_TOKEN (Vercel/Upstash KV) or " +
    "CF_ACCOUNT_ID + CF_API_TOKEN + CF_KV_NAMESPACE_ID " +
    "(Cloudflare KV REST; use autocopy wrangler SESSION_KEYS_KV id). " +
    "Local .data/follow-rules.json is not writable on Vercel serverless — " +
    "Auto-Follow would fail with ENOENT on mkdir."
  );
}

function assertWritableBackend(
  kind: FollowRulesBackendKind,
  opts?: { filePath?: string },
): void {
  if (opts?.filePath) return;
  if (kind === "file" && isVercelRuntimeHint() && !durableBackendConfigured()) {
    throw new FollowRulesPersistError(missingDurableBackendMessage());
  }
}

function workerNote(backend: FollowRulesBackendKind): string {
  if (backend === "file") {
    return (
      `Local file store only (${defaultStorePath()}). Autocopy still needs SESSION_KEYS_KV ` +
      `follower:{wallet}:{whale} records with sessionKey after Authorize.`
    );
  }
  if (backend === "upstash") {
    return (
      `Persisted in Upstash/Vercel KV (web:follow-rules:{wallet}). Autocopy still needs ` +
      `SESSION_KEYS_KV follower:{wallet}:{whale} with sessionKey for the worker.`
    );
  }
  return (
    `Persisted in Cloudflare KV (web:follow-rules:{wallet}). Autocopy follower rules still need ` +
    `follower:{wallet}:{whale} with AutoCopyRule.sessionKey set in SESSION_KEYS_KV.`
  );
}

export function followRulesPersistenceMeta(
  backend: FollowRulesBackendKind = resolveFollowRulesBackend(),
): { persistence: FollowRulesBackendKind; workerNote: string } {
  return {
    persistence: backend,
    workerNote: workerNote(backend),
  };
}

type StoreFile = Record<string, StoredFollowRule[]>;

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
    try {
      await fs.chmod(filePath, 0o600);
    } catch {
      // best-effort on platforms that ignore chmod
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EROFS" || code === "EACCES" || code === "EPERM" || code === "ENOENT") {
      throw new FollowRulesPersistError(
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
    throw new FollowRulesPersistError(
      `Upstash/Vercel KV ${command[0]} failed (${res.status}): ${text.slice(0, 200) || res.statusText}`,
    );
  }
  const json = (await res.json()) as { result?: unknown; error?: string };
  if (json.error) {
    throw new FollowRulesPersistError(`Upstash/Vercel KV error: ${json.error}`);
  }
  return json.result;
}

async function cfKvUrl(key: string): Promise<{
  url: string;
  headers: Record<string, string>;
}> {
  const env = cloudflareKvEnv();
  if (!env) {
    throw new FollowRulesPersistError(missingDurableBackendMessage());
  }
  const encoded = encodeURIComponent(key);
  return {
    url: `https://api.cloudflare.com/client/v4/accounts/${env.accountId}/storage/kv/namespaces/${env.namespaceId}/values/${encoded}`,
    headers: { Authorization: `Bearer ${env.apiToken}` },
  };
}

function parseRulesPayload(raw: string): StoredFollowRule[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new FollowRulesPersistError("Follow-rules KV payload must be a JSON array");
  }
  return parsed as StoredFollowRule[];
}

async function getRulesFromUpstash(wallet: string): Promise<StoredFollowRule[]> {
  const env = upstashEnv();
  if (!env) return [];
  const result = await upstashCommand(env, ["GET", followRulesKvKey(wallet)]);
  if (result == null || result === "") return [];
  if (typeof result !== "string") {
    throw new FollowRulesPersistError("Upstash/Vercel KV returned non-string follow-rules payload");
  }
  return parseRulesPayload(result);
}

async function putRulesToUpstash(wallet: string, rules: StoredFollowRule[]): Promise<void> {
  const env = upstashEnv();
  if (!env) throw new FollowRulesPersistError(missingDurableBackendMessage());
  if (rules.length === 0) {
    await upstashCommand(env, ["DEL", followRulesKvKey(wallet)]);
    return;
  }
  await upstashCommand(env, ["SET", followRulesKvKey(wallet), JSON.stringify(rules)]);
}

async function getRulesFromCloudflare(wallet: string): Promise<StoredFollowRule[]> {
  const { url, headers } = await cfKvUrl(followRulesKvKey(wallet));
  const res = await fetch(url, { headers });
  if (res.status === 404) return [];
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new FollowRulesPersistError(
      `Cloudflare KV GET failed (${res.status}): ${text.slice(0, 200) || res.statusText}`,
    );
  }
  const raw = await res.text();
  if (!raw) return [];
  return parseRulesPayload(raw);
}

async function putRulesToCloudflare(wallet: string, rules: StoredFollowRule[]): Promise<void> {
  const { url, headers } = await cfKvUrl(followRulesKvKey(wallet));
  if (rules.length === 0) {
    const res = await fetch(url, { method: "DELETE", headers });
    if (res.status === 404) return;
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new FollowRulesPersistError(
        `Cloudflare KV DELETE failed (${res.status}): ${text.slice(0, 200) || res.statusText}`,
      );
    }
    return;
  }
  const res = await fetch(url, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(rules),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new FollowRulesPersistError(
      `Cloudflare KV PUT failed (${res.status}): ${text.slice(0, 200) || res.statusText}`,
    );
  }
}

function sanitizeRule(input: Partial<AutoCopyRule> & { whaleAddress: string }): AutoCopyRule {
  const whaleAddress = normalizeAddress(input.whaleAddress);
  if (!isAddress(whaleAddress)) {
    throw new Error("Invalid whaleAddress");
  }

  const status = input.status === "PAUSED" ? "PAUSED" : "ACTIVE";
  const maxStake = Number(input.maxStake);
  const slippageCap = Number(input.slippageCap);
  const cashOutTarget = Number(input.cashOutTarget);
  const stopLossRounds = Number(input.stopLossRounds);
  const maxRounds = Number(input.maxRounds);
  const dailyCap = Number(input.dailyCap);

  if (!Number.isFinite(maxStake) || maxStake <= 0) {
    throw new Error("maxStake must be a positive number");
  }
  if (!Number.isFinite(slippageCap) || slippageCap < 0) {
    throw new Error("slippageCap must be a non-negative number");
  }

  return {
    whaleAddress,
    maxStake,
    slippageCap: Number.isFinite(slippageCap) ? slippageCap : 1,
    status,
    autoRoll: Boolean(input.autoRoll),
    cashOutTarget: Number.isFinite(cashOutTarget) && cashOutTarget > 0 ? cashOutTarget : 150,
    stopLossRounds:
      Number.isFinite(stopLossRounds) && stopLossRounds >= 1 ? Math.floor(stopLossRounds) : 3,
    maxRounds: Number.isFinite(maxRounds) && maxRounds >= 1 ? Math.floor(maxRounds) : 20,
    dailyCap: Number.isFinite(dailyCap) && dailyCap >= 0 ? dailyCap : 100,
  };
}

/** Default UI rule when Auto-Follow is first enabled for a whale. */
export function defaultFollowRule(whaleAddress: string): AutoCopyRule {
  return sanitizeRule({
    whaleAddress,
    maxStake: 10,
    slippageCap: 1,
    status: "ACTIVE",
    autoRoll: false,
    cashOutTarget: 150,
    stopLossRounds: 3,
    maxRounds: 20,
    dailyCap: 100,
  });
}

async function readWalletRules(
  walletAddress: string,
  filePath?: string,
): Promise<StoredFollowRule[]> {
  const backend = resolveFollowRulesBackend({ filePath });
  if (backend === "upstash") {
    return getRulesFromUpstash(walletAddress);
  }
  if (backend === "cloudflare-kv") {
    return getRulesFromCloudflare(walletAddress);
  }
  const store = await readFileStore(filePath ?? defaultStorePath());
  return store[normalizeAddress(walletAddress)] ?? [];
}

async function writeWalletRules(
  walletAddress: string,
  rules: StoredFollowRule[],
  filePath?: string,
): Promise<void> {
  const backend = resolveFollowRulesBackend({ filePath });
  assertWritableBackend(backend, { filePath });

  if (backend === "upstash") {
    await putRulesToUpstash(walletAddress, rules);
    return;
  }
  if (backend === "cloudflare-kv") {
    await putRulesToCloudflare(walletAddress, rules);
    return;
  }

  const pathToUse = filePath ?? defaultStorePath();
  const key = normalizeAddress(walletAddress);
  const store = await readFileStore(pathToUse);
  if (rules.length === 0) {
    delete store[key];
  } else {
    store[key] = rules;
  }
  await writeFileStore(store, pathToUse);
}

export async function listFollowRules(
  walletAddress: string,
  filePath?: string,
): Promise<StoredFollowRule[]> {
  if (!isAddress(walletAddress)) return [];
  return readWalletRules(walletAddress, filePath);
}

export async function upsertFollowRule(
  walletAddress: string,
  ruleInput: Partial<AutoCopyRule> & { whaleAddress: string },
  filePath?: string,
): Promise<StoredFollowRule> {
  if (!isAddress(walletAddress)) {
    throw new Error("Invalid walletAddress");
  }
  const rule = sanitizeRule(ruleInput);
  const now = new Date().toISOString();
  const existing = await readWalletRules(walletAddress, filePath);
  const idx = existing.findIndex(
    (r) => r.whaleAddress.toLowerCase() === rule.whaleAddress.toLowerCase(),
  );
  let saved: StoredFollowRule;
  if (idx >= 0) {
    saved = {
      ...existing[idx],
      ...rule,
      updatedAt: now,
    };
    existing[idx] = saved;
  } else {
    saved = { ...rule, createdAt: now, updatedAt: now };
    existing.push(saved);
  }
  await writeWalletRules(walletAddress, existing, filePath);
  return saved;
}

export async function deleteFollowRule(
  walletAddress: string,
  whaleAddress: string,
  filePath?: string,
): Promise<boolean> {
  if (!isAddress(walletAddress) || !isAddress(whaleAddress)) return false;
  const whale = normalizeAddress(whaleAddress);
  const existing = await readWalletRules(walletAddress, filePath);
  const next = existing.filter((r) => r.whaleAddress.toLowerCase() !== whale);
  if (next.length === existing.length) return false;
  await writeWalletRules(walletAddress, next, filePath);
  return true;
}

export function toPublicRule(rule: StoredFollowRule): AutoCopyRule & {
  createdAt: string;
  updatedAt: string;
} {
  return {
    whaleAddress: rule.whaleAddress,
    maxStake: rule.maxStake,
    slippageCap: rule.slippageCap,
    status: rule.status,
    autoRoll: rule.autoRoll,
    cashOutTarget: rule.cashOutTarget,
    stopLossRounds: rule.stopLossRounds,
    maxRounds: rule.maxRounds,
    dailyCap: rule.dailyCap,
    createdAt: rule.createdAt,
    updatedAt: rule.updatedAt,
  };
}
