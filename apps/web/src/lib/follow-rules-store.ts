/**
 * Local/dev persistence for Auto-Follow / Settings follow rules.
 *
 * Mirrors session-key-store: `.data/follow-rules.json` (gitignored, mode 600).
 * UI AutoCopyRule shape (edit-rule-modal) — not the worker AutoCopyRule that
 * also carries sessionKey / dailyVolume. Worker SESSION_KEYS_KV sync remains
 * a separate ops step after session-key authorize.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import type { AutoCopyRule } from "@/components/edit-rule-modal";

export type StoredFollowRule = AutoCopyRule & {
  createdAt: string;
  updatedAt: string;
};

const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;

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

type StoreFile = Record<string, StoredFollowRule[]>;

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
  try {
    await fs.chmod(filePath, 0o600);
  } catch {
    // best-effort on platforms that ignore chmod
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

export async function listFollowRules(
  walletAddress: string,
  filePath = defaultStorePath(),
): Promise<StoredFollowRule[]> {
  if (!isAddress(walletAddress)) return [];
  const store = await readStore(filePath);
  return store[normalizeAddress(walletAddress)] ?? [];
}

export async function upsertFollowRule(
  walletAddress: string,
  ruleInput: Partial<AutoCopyRule> & { whaleAddress: string },
  filePath = defaultStorePath(),
): Promise<StoredFollowRule> {
  if (!isAddress(walletAddress)) {
    throw new Error("Invalid walletAddress");
  }
  const rule = sanitizeRule(ruleInput);
  const now = new Date().toISOString();
  const key = normalizeAddress(walletAddress);
  const store = await readStore(filePath);
  const existing = store[key] ?? [];
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
  store[key] = existing;
  await writeStore(store, filePath);
  return saved;
}

export async function deleteFollowRule(
  walletAddress: string,
  whaleAddress: string,
  filePath = defaultStorePath(),
): Promise<boolean> {
  if (!isAddress(walletAddress) || !isAddress(whaleAddress)) return false;
  const key = normalizeAddress(walletAddress);
  const whale = normalizeAddress(whaleAddress);
  const store = await readStore(filePath);
  const existing = store[key] ?? [];
  const next = existing.filter((r) => r.whaleAddress.toLowerCase() !== whale);
  if (next.length === existing.length) return false;
  if (next.length === 0) {
    delete store[key];
  } else {
    store[key] = next;
  }
  await writeStore(store, filePath);
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
