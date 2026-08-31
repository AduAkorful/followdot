import { useQuery } from "@tanstack/react-query";
import { fetchWhaleProfile, type WhaleProfileData } from "@/lib/whale-profile";

export const WHALE_PROFILE_QUERY_KEY = "whale-profile";

export function useWhaleProfile(address: string) {
  return useQuery<WhaleProfileData, Error>({
    queryKey: [WHALE_PROFILE_QUERY_KEY, address],
    queryFn: ({ signal }) => fetchWhaleProfile(address, signal),
    staleTime: 60_000,
    retry: 1,
    retryDelay: 5_000,
    enabled: !!address && /^0x[a-fA-F0-9]{40}$/.test(address),
  });
}
