# Followdot Market Bot

This is a separate DreamDEX Event Contract activity bot for Somnia Shannon testnet. It discovers a live market, applies live on-chain/indexer checks, and can place one bounded IOC buy. It exists to create legitimate indexed activity for Followdot's end-to-end verification; it is not the consumer auto-copy worker.

## Safety

- No market, trader, key, price, fill, or transaction data is hardcoded.
- Missing or stale live data blocks signing.
- `CHECK_ONLY=true` performs discovery only and does not require a private key.
- Signing mode requires a dedicated funded testnet wallet and `PRIVATE_KEY` from a secret manager.
- `RUN_ONCE=true` is the supported initial mode. Set `CONTINUOUS=true` and `RUN_ONCE=false` only after the one-shot path is proven. Do not use self-trading to manufacture leaderboard activity.

## Local setup

Copy `.env.example` to a local environment file and set a real private key only for signing mode:

```bash
cp .env.example .env
pnpm install
```

Read-only discovery:

```bash
set -a; . ./.env; set +a
CHECK_ONLY=true pnpm --filter @followdot/market-bot dev
```

Signing smoke test:

```bash
set -a; . ./.env; set +a
CHECK_ONLY=false RUN_ONCE=true pnpm --filter @followdot/market-bot dev
```

Continuous mode:

```bash
set -a; . ./.env; set +a
CONTINUOUS=true RUN_ONCE=false pnpm --filter @followdot/market-bot dev
```

Continuous mode places at most one order per discovered market, waits between cycles, and keeps running when no market passes the live checks. Use a persistent Render disk or an external durable state store for `BOT_STATE_FILE`; an ephemeral filesystem can lose the duplicate-protection state on restart.

The bot logs the selected market, transaction hash, and indexed fill as JSON. A confirmed transaction without an indexed fill remains an in-flight state and must be investigated before retrying.

## Render deployment

The repository includes [`render.yaml`](../../render.yaml) for a Render Background Worker. It mounts a persistent disk at `/var/lib/followdot-market-bot`, which is required for duplicate protection and in-flight recovery.

Configure the `sync: false` values in the Render dashboard. For the first deployment use:

```text
CHECK_ONLY=false
RUN_ONCE=true
CONTINUOUS=false
```

After a real receipt and indexed fill are confirmed, switch to:

```text
CHECK_ONLY=false
RUN_ONCE=false
CONTINUOUS=true
```

The continuous worker places at most one bounded IOC order per unexecuted market, waits `POLL_INTERVAL_MS`, and retries discovery when no market passes live checks. Render's always-on background workers and persistent disks may require a paid plan; do not use an ephemeral filesystem for `BOT_STATE_FILE`.
