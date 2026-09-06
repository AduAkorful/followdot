/**
 * Follow / auto-copy rules shared by Settings, Performance, and whale Auto-Follow.
 *
 * Persistence: local Next.js API → `.data/follow-rules.json` (see follow-rules-store).
 * Until a rule is saved, both surfaces show an honest empty state — never a
 * fetch-failure "—" for "Whales Monitored".
 */
import type { AutoCopyRule } from '@/components/edit-rule-modal';

export type { AutoCopyRule };

/** Empty-state copy for Performance KPI + Settings list. */
export const NO_WHALES_FOLLOWED_YET = 'No whales followed yet';

export const FOLLOW_RULES_QUERY_KEY = 'follow-rules';

export interface FollowRulesResponse {
  walletAddress: string;
  rules: AutoCopyRule[];
  persistence?: string;
  workerNote?: string;
}

/**
 * @deprecated Sync stub — persistence is async via {@link fetchFollowRules}.
 * Kept returning [] so accidental sync callers stay honest-empty.
 */
export function loadFollowRules(_walletAddress?: string | null): AutoCopyRule[] {
  return [];
}

/** Distinct whale count from a rule list (case-insensitive address). */
export function countMonitoredWhales(rules: AutoCopyRule[]): number {
  const seen = new Set<string>();
  for (const rule of rules) {
    const addr = rule.whaleAddress?.trim().toLowerCase();
    if (addr) seen.add(addr);
  }
  return seen.size;
}

export async function fetchFollowRules(walletAddress: string): Promise<FollowRulesResponse> {
  const res = await fetch(
    `/api/follow-rules?wallet=${encodeURIComponent(walletAddress)}`,
    { headers: { 'x-wallet-address': walletAddress } },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Failed to load follow rules (${res.status})`);
  }
  return (await res.json()) as FollowRulesResponse;
}

export async function saveFollowRule(
  walletAddress: string,
  rule: AutoCopyRule,
): Promise<AutoCopyRule> {
  const res = await fetch('/api/follow-rules', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-wallet-address': walletAddress,
    },
    body: JSON.stringify({ walletAddress, rule }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Failed to save follow rule (${res.status})`);
  }
  const data = (await res.json()) as { rule: AutoCopyRule };
  return data.rule;
}

export async function removeFollowRule(
  walletAddress: string,
  whaleAddress: string,
): Promise<void> {
  const res = await fetch(
    `/api/follow-rules?wallet=${encodeURIComponent(walletAddress)}&whale=${encodeURIComponent(whaleAddress)}`,
    {
      method: 'DELETE',
      headers: { 'x-wallet-address': walletAddress },
    },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Failed to delete follow rule (${res.status})`);
  }
}
