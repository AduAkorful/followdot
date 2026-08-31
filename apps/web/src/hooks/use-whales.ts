import { useQuery } from "@tanstack/react-query";
import { fetchWhaleLeaderboard, type WhaleLeaderboardEntry } from "@/lib/whales";

export const WHALE_QUERY_KEY = "whale-leaderboard";

export function useWhaleLeaderboard(limit = 20) {
  return useQuery<WhaleLeaderboardEntry[], Error>({
    queryKey: [WHALE_QUERY_KEY, limit],
    queryFn: ({ signal }) => fetchWhaleLeaderboard(limit, signal),
    staleTime: 60_000, // 1 minute — markets resolve frequently
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    retry: 1, // Don't triple the multi-second pipeline on failure
    retryDelay: 5_000,
  });
}
