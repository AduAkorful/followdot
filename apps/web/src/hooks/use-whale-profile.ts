import { useQuery } from "@tanstack/react-query";
import {
  mergeWhaleProfile,
  type WhaleProfileAnalytics,
  type WhaleProfileCore,
  type WhaleProfileData,
} from "@/lib/whale-profile";

export const WHALE_PROFILE_QUERY_KEY = "whale-profile";
export const WHALE_PROFILE_ANALYTICS_QUERY_KEY = "whale-profile-analytics";

async function fetchWhaleProfileCoreApi(
  address: string,
  signal?: AbortSignal,
): Promise<WhaleProfileCore> {
  const res = await fetch(`/api/whales/${address}`, {
    signal,
    cache: "no-store",
  });
  const body = (await res.json()) as {
    profile?: WhaleProfileCore;
    error?: string;
  };
  if (!res.ok) {
    throw new Error(body.error || `Whale profile request failed (${res.status})`);
  }
  if (!body.profile) throw new Error("Whale profile response missing profile");
  return body.profile;
}

async function fetchWhaleProfileAnalyticsApi(
  address: string,
  signal?: AbortSignal,
): Promise<WhaleProfileAnalytics> {
  const res = await fetch(`/api/whales/${address}/analytics`, {
    signal,
    cache: "no-store",
  });
  const body = (await res.json()) as {
    analytics?: WhaleProfileAnalytics;
    error?: string;
  };
  if (!res.ok) {
    throw new Error(body.error || `Whale analytics request failed (${res.status})`);
  }
  if (!body.analytics) throw new Error("Whale analytics response missing analytics");
  return body.analytics;
}

/** Critical-path KPIs via server API (no sequential edge RPCs in the browser). */
export function useWhaleProfile(address: string) {
  return useQuery<WhaleProfileData, Error>({
    queryKey: [WHALE_PROFILE_QUERY_KEY, address],
    queryFn: async ({ signal }) => {
      const core = await fetchWhaleProfileCoreApi(address, signal);
      return mergeWhaleProfile(core, null);
    },
    staleTime: 60_000,
    retry: 1,
    retryDelay: 5_000,
    enabled: !!address && /^0x[a-fA-F0-9]{40}$/.test(address),
  });
}

/** Lazy F7/F8 — enable after core paint / when the edge tab is needed. */
export function useWhaleProfileAnalytics(address: string, enabled = true) {
  return useQuery<WhaleProfileAnalytics, Error>({
    queryKey: [WHALE_PROFILE_ANALYTICS_QUERY_KEY, address],
    queryFn: ({ signal }) => fetchWhaleProfileAnalyticsApi(address, signal),
    staleTime: 120_000,
    retry: 1,
    retryDelay: 5_000,
    enabled: enabled && !!address && /^0x[a-fA-F0-9]{40}$/.test(address),
  });
}
