# Followdot Market Bot

This is a separate DreamDEX Event Contract activity bot for Somnia Shannon testnet. It discovers a live market, applies live on-chain/indexer checks, and can place one bounded IOC buy. It exists to create legitimate indexed activity for Followdot's end-to-end verification; it is not the consumer auto-copy worker.

## Safety

- No market, trader, key, price, fill, or transaction data is hardcoded.
- Missing or stale live data blocks signing.
- `CHECK_ONLY=true` performs discovery only and does not require a private key.
- Signing mode requires a dedicated funded testnet wallet and `PRIVATE_KEY` from a secret manager.
- `RUN_ONCE=true` is the supported initial mode. Do not use self-trading to manufacture leaderboard activity.

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

The bot logs the selected market, transaction hash, and indexed fill as JSON. A confirmed transaction without an indexed fill remains an in-flight state and must be investigated before retrying.

## Deployment

Railway is the recommended first host for the one-shot/continuous Node process. Configure the variables from `.env.example` as Railway secrets/variables. Deploy with `RUN_ONCE=true` for the first smoke test, then inspect the real receipt and fill in the Shannon indexer before enabling any repeated mode.
