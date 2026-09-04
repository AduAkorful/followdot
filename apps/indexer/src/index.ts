import {
  createDreamDexSDK,
  computeSkillScores,
  fetchRecentFills,
  extractTopTraders,
} from "@followdot/sdk-helpers";

interface Env {
  WHALE_KV: KVNamespace;
  SKILL_KV: KVNamespace;
  API_TOKEN?: string;
  // Required runtime endpoints. Missing values fail closed during execution.
  DREAMDEX_REST_URL?: string;
  DREAMDEX_WS_URL?: string;
}

const WHALE_LEADERBOARD_LIMIT = 20;
// The web app computes the whale leaderboard live from the indexer
// GraphQL (see apps/web/src/lib/whales.ts) — it does NOT consume the
// indexer worker's KV output. The cron below is therefore a no-op
// discovery pass that only refreshes the WHALE_KV directory when a
// new top-trader address is observed. We don't write skill scores to
// KV from this worker; the next cron tick simply re-discovers whales.

async function runDiscovery(env: Env): Promise<{ newWhales: number }> {
  const sdk = createDreamDexSDK({
    restUrl: env.DREAMDEX_REST_URL,
    wsUrl: env.DREAMDEX_WS_URL,
  });

  const fills = await fetchRecentFills(100);
  const topTraders = extractTopTraders(fills, WHALE_LEADERBOARD_LIMIT);

  let newWhales = 0;
  for (const addr of topTraders) {
    const existing = await env.WHALE_KV.get(`whale:${addr}`);
    if (!existing) {
      await env.WHALE_KV.put(`whale:${addr}`, addr);
      newWhales += 1;
    }
  }

  return { newWhales };
}

export default {
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    try {
      const { newWhales } = await runDiscovery(env);
      console.log(`[indexer] discovery ok — ${newWhales} new whales`);
    } catch (err) {
      console.error("[indexer] discovery failed:", err);
      throw err;
    }
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response("ok", { status: 200 });
    }

    const token = request.headers.get("x-api-token");
    if (!env.API_TOKEN) {
      return new Response("Authorization is not configured", { status: 503 });
    }
    if (token !== env.API_TOKEN) {
      return new Response("Unauthorized", { status: 401 });
    }

    if (url.pathname === "/index") {
      const { newWhales } = await runDiscovery(env);
      return new Response(JSON.stringify({ newWhales }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    return new Response("Not found", { status: 404 });
  },
};
