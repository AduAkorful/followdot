import { createDreamDexSDK, pollWhaleFills, routeCopyOrders } from '@followdot/sdk-helpers';

interface Env {
  WHALE_KV: KVNamespace;
  SESSION_KEYS_KV: KVNamespace;
  API_TOKEN?: string;
  // Optional overrides — if unset, defaults to the testnet stg.api.dreamdex.io.
  DREAMDEX_REST_URL?: string;
  DREAMDEX_WS_URL?: string;
}

export default {
  async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    const sdk = createDreamDexSDK({
      restUrl: env.DREAMDEX_REST_URL,
      wsUrl: env.DREAMDEX_WS_URL,
    });

    try {
      // Poll recent fills for monitored whales and store them in KV
      if (env.WHALE_KV && env.SESSION_KEYS_KV) {
        await pollWhaleFills(sdk, env.WHALE_KV, env.SESSION_KEYS_KV);

        // For each new whale fill, route proportional copy orders
        // to followers who have granted session-key approval
        await routeCopyOrders(sdk, env.SESSION_KEYS_KV);
      }
    } catch (err) {
      console.error('[autocopy] scheduled task failed:', err);
      throw err;
    }
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      // Unauthenticated liveness check
      return new Response('ok', { status: 200 });
    }

    // All other routes require a valid API token
    const token = request.headers.get('x-api-token');
    if (env.API_TOKEN && token !== env.API_TOKEN) {
      return new Response('Unauthorized', { status: 401 });
    }

    if (url.pathname === '/copy') {
      return this.scheduled(
        { scheduledTime: Date.now() } as ScheduledController,
        env,
        {
          waitUntil: () => {},
          passThroughOnException: () => {},
          blockWorkers: () => {},
        } as ExecutionContext,
      ).then(() => new Response('copy-routed', { status: 200 }));
    }

    return new Response('Not found', { status: 404 });
  },
};
