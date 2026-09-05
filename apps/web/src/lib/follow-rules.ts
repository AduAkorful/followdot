/**
 * Follow / auto-copy rules shared by Settings and Performance.
 *
 * Persistence is not wired yet: whale Auto-Follow is disabled, Settings only
 * holds an in-memory list, and Cloudflare SESSION_KEYS_KV
 * `follower:{wallet}:{whale}` records are not listed from the Next.js app.
 * Until a real store exists, both surfaces must show an honest empty state —
 * never a fetch-failure "—" for "Whales Monitored".
 */
import type { AutoCopyRule } from '@/components/edit-rule-modal';

export type { AutoCopyRule };

/** Empty-state copy for Performance KPI + Settings list. */
export const NO_WHALES_FOLLOWED_YET = 'No whales followed yet';

/**
 * Load persisted follow rules for the connected user.
 * Always returns [] until Auto-Follow / KV / file persistence is implemented.
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
