import { useQuery, keepPreviousData } from "@tanstack/react-query";
import {
  parseWhaleLeaderboardPayload,
  type WhaleLeaderboardPayload,
} from "@/lib/whales";

export const WHALE_QUERY_KEY = "whale-leaderboard";
/** Abort before Vercel maxDuration (60s) so the UI can show a retry error. */
export const WHALE_LEADERBOARD_CLIENT_TIMEOUT_MS = 35_000;

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = "name" in err && typeof err.name === "string" ? err.name : "";
  const message = "message" in err && typeof err.message === "string" ? err.message : "";
  return name === "AbortError" || /aborted|timed out/i.test(message);
}

async function fetchWhaleLeaderboardApi(
  limit: number,
  signal?: AbortSignal,
): Promise<WhaleLeaderboardPayload> {
  const controller = new AbortController();
  const onParentAbort = () => controller.abort();
  signal?.addEventListener("abort", onParentAbort);
  const timer = setTimeout(() => controller.abort(), WHALE_LEADERBOARD_CLIENT_TIMEOUT_MS);

  try {
    const res = await fetch(`/api/whales?limit=${limit}`, {
      signal: controller.signal,
      cache: "no-store",
    });

    const text = await res.text();
    let body: unknown = {};
    if (text) {
      try {
        body = JSON.parse(text) as unknown;
      } catch {
        throw new Error(
          res.status === 504
            ? "Leaderboard timed out (504). Retry in a moment."
            : `Leaderboard request failed (${res.status})`,
        );
      }
    }

    const payload = parseWhaleLeaderboardPayload(body);
    if (!res.ok) {
      const error =
        body && typeof body === "object" && "error" in body && typeof (body as { error?: unknown }).error === "string"
          ? (body as { error: string }).error
          : res.status === 504
            ? "Leaderboard timed out (504). Retry in a moment."
            : `Leaderboard request failed (${res.status})`;
      throw new Error(error);
    }
    return payload;
  } catch (err) {
    if (isAbortError(err)) {
      throw new Error("Leaderboard request timed out. Retry in a moment.");
    }
    throw err;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onParentAbort);
  }
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
