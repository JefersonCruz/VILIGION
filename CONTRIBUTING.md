# Contributing

New here? Start with [`docs/TEAM-PLAYBOOK.md`](./docs/TEAM-PLAYBOOK.md) — roles, where to see the project's current state, which communication channel is for what (and what is never asked on any of them), and the tools that already exist. This file covers the technical rules only.

## Before anything

This project has two parts with different rules:

1. **TIP-403/`ReceivePolicyGuard` decoding library** (`/engine/chains/tempo.adapter.ts` and related modules) — contributions welcome from any builder in the Tempo ecosystem. This part is meant to be shared infrastructure.
2. **Alert/privacy product** (`/privacy`, `/alerts`, `/dashboard`) — changes here require understanding the threat model in [`SECURITY.md`](./SECURITY.md) before opening a PR. Any change touching authentication, encryption, or alert content needs to explicitly justify how it preserves (or improves) every item in the mitigation table.

## General rules

- Never commit secrets, keys, or real user data — not in code, not in examples, not in tests.
- `.env.example` must contain only variable names, never real values.
- User-specific detection thresholds never go hardcoded into public code.
- PRs touching `/privacy` or `/alerts` need at least one additional review before merge.

## Running locally

Requires Node.js 20+.

```bash
git clone https://github.com/JefersonCruz/VILIGION.git
cd VILIGION
npm install
cp .env.example .env
npm test        # should pass with zero setup - confirms your clone is sound before touching env vars
```

### Fastest path: demo mode, no database

Fill in just these three variables in `.env` (see `.env.example` for the full list and why each one matters):

```
TEMPO_RPC_URL=https://rpc.moderato.tempo.xyz
TEMPO_CHAIN_ID=42431
DEMO_WATCHED_ADDRESS=0x0000000000000000000000000000000000dEaD
```

`DEMO_WATCHED_ADDRESS` can be any address - the engine will just watch its real TIP-20 balance on Tempo's public Moderato testnet, no account or faucet needed to observe it. Then:

```bash
npm run dev
```

The console prints a demo login (username, password, TOTP secret) the moment the server starts - use it at `http://localhost:3000/login`. Twilio and SMTP are intentionally optional here: without them, alerts just print to the console instead of actually calling or emailing anyone (see `SECURITY.md` for why this is a deliberate product decision, not a missing feature).

### Full setup: with Postgres (multi-user portal, dynamic account registration)

Add `DATABASE_URL` (any Postgres 14+ works; Railway/Neon/Supabase all have a free tier) and `ENCRYPTION_KEY_KMS_ARN` (generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` - this is a dev-only stand-in for a real KMS key, see issue #9), then:

```bash
npm run migrate   # applies privacy/mapping-schema.sql
npm run dev
```

Sign up a real account at `/signup` instead of using the printed demo login.

### Verifying a change before opening a PR

```bash
npm test                              # full suite
npx tsc -p tsconfig.json --noEmit     # typecheck - CI runs both, catches most issues locally first
```

For anything touching chain interaction specifically, `scripts/verify-testnet.ts` confirms your change still decodes real events against Tempo's Moderato testnet, not just mocked data.

## Reporting bugs vs. security vulnerabilities

Regular bug → public issue. Security vulnerability → see the responsible disclosure process in [`SECURITY.md`](./SECURITY.md), never a public issue.
