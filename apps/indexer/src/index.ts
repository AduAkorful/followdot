import { createDreamDexSDK, computeSkillScores, persistToKV, fetchRecentFills, extractTopTraders } from '@followdot/sdk-helpers';

interface Env {
  WHALE_KV: KVNamespace;
  SKILL_KV: KVNamespace;
  API_TOKEN?: string;
  // Required runtime endpoints. Missing values fail closed during execution.
  DREAMDEX_REST_URL?: string;
  DREAMDEX_WS_URL?: string;
}

const WHALE_LEADERBOARD_LIMIT = 20;

async function runIndex(env: Env): Promise<void> {
  const sdk = createDreamDexSDK({
    restUrl: env.DREAMDEX_REST_URL,
    wsUrl: env.DREAMDEX_WS_URL,
  });

  try {
    // Discover top traders from recent fills via the indexer
    const fills = await fetchRecentFills(WHALE_LEADERBOARD_LIMIT * 25);
    const topTraders = extractTopTraders(fills, WHALE_LEADERBOARD_LIMIT);

    // Store discovered whale addresses in WHALE_KV
    for (const addr of topTraders) {
      await env.WHALE_KV.put(`whale:${addr}`, addr);
    }

    // Compute and persist skill scores for all stored whales
    const results = await computeSkillScores(sdk, env.WHALE_KV, env.SKILL_KV);
    await persistToKV(env.SKILL_KV, results);
  } catch (err) {
    console.error('[indexer] indexing failed:', err);
    throw err;
  }
}

export default {
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    await runIndex(env);
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      // Unauthenticated liveness check — returns 200 if the worker is up.
      // For production, restrict to internal IPs or a health-check token.
      return new Response('ok', { status: 200 });
    }

    // All other routes require a valid API token
    const token = request.headers.get('x-api-token');
    if (!env.API_TOKEN) {
      return new Response('Authorization is not configured', { status: 503 });
    }
    if (token !== env.API_TOKEN) {
      return new Response('Unauthorized', { status: 401 });
    }

    if (url.pathname === '/index') {
      await runIndex(env);
      return new Response('indexed', { status: 200 });
    }

    return new Response('Not found', { status: 404 });
  },
};
