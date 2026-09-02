import { createDreamDexSDK, pollWhaleFills, routeCopyOrders } from '@followdot/sdk-helpers';

interface Env {
  WHALE_KV: KVNamespace;
  SESSION_KEYS_KV: KVNamespace;
  API_TOKEN?: string;
  // Required runtime endpoints. Missing values fail closed during execution.
  DREAMDEX_REST_URL?: string;
  DREAMDEX_WS_URL?: string;
}

async function runCopyRouting(env: Env): Promise<void> {
  const sdk = createDreamDexSDK({
    restUrl: env.DREAMDEX_REST_URL,
    wsUrl: env.DREAMDEX_WS_URL,
  });

  try {
    // Poll recent fills for monitored whales and store them in KV
    await pollWhaleFills(sdk, env.WHALE_KV, env.SESSION_KEYS_KV);

    // Route new whale fills to followers with persisted session-key approval.
    await routeCopyOrders(sdk, env.SESSION_KEYS_KV, {
      followerAddresses: [],
      dryRun: false,
    });
  } catch (err) {
    console.error('[autocopy] copy routing failed:', err);
    throw err;
  }
}

export default {
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    await runCopyRouting(env);
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      // Unauthenticated liveness check
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

    if (url.pathname === '/copy') {
      await runCopyRouting(env);
      return new Response('copy-routed', { status: 200 });
    }

    return new Response('Not found', { status: 404 });
  },
};
