import { useQuery } from "@tanstack/react-query";
import type { WhaleLeaderboardEntry } from "@/lib/whales";

export const WHALE_QUERY_KEY = "whale-leaderboard";

async function fetchWhaleLeaderboardApi(
  limit: number,
  signal?: AbortSignal,
): Promise<WhaleLeaderboardEntry[]> {
  const res = await fetch(`/api/whales?limit=${limit}`, {
    signal,
    cache: "no-store",
  });
  const body = (await res.json()) as {
    whales?: WhaleLeaderboardEntry[];
    error?: string;
  };
  if (!res.ok) {
    throw new Error(body.error || `Leaderboard request failed (${res.status})`);
  }
  return body.whales ?? [];
}

export function useWhaleLeaderboard(limit = 20) {
  return useQuery<WhaleLeaderboardEntry[], Error>({
    queryKey: [WHALE_QUERY_KEY, limit],
    queryFn: ({ signal }) => fetchWhaleLeaderboardApi(limit, signal),
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    retry: 1,
    retryDelay: 5_000,
  });
}
