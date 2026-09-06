import { useQuery, keepPreviousData } from "@tanstack/react-query";
import {
  parseWhaleLeaderboardPayload,
  type WhaleLeaderboardPayload,
} from "@/lib/whales";

export const WHALE_QUERY_KEY = "whale-leaderboard";

async function fetchWhaleLeaderboardApi(
  limit: number,
  signal?: AbortSignal,
): Promise<WhaleLeaderboardPayload> {
  const res = await fetch(`/api/whales?limit=${limit}`, {
    signal,
    cache: "no-store",
  });
  const body: unknown = await res.json();
  const payload = parseWhaleLeaderboardPayload(body);
  if (!res.ok) {
    const error =
      body && typeof body === "object" && "error" in body && typeof body.error === "string"
        ? body.error
        : `Leaderboard request failed (${res.status})`;
    throw new Error(error);
  }
  return payload;
}

export function useWhaleLeaderboard(limit = 20) {
  return useQuery<WhaleLeaderboardPayload, Error>({
    queryKey: [WHALE_QUERY_KEY, limit],
    queryFn: ({ signal }) => fetchWhaleLeaderboardApi(limit, signal),
    staleTime: 30_000,
    // Keep last snapshot painted while a background refresh runs — avoids blanking home.
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    retry: 1,
    retryDelay: 5_000,
  });
}
