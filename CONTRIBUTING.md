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
- Don't claim a capability that isn't verified. If you didn't run it against the real thing, say so — in the code, in the PR, and in the docs. An honest gap gets reviewed quickly; an undisclosed one is what makes a review slow and uncomfortable for everyone.

## Adding support for a new network

This is the contribution the project most wants right now, and it's designed to need no coordination with the maintainer.

Start here:

1. [`docs/DEVELOPING_ADAPTERS.md`](./docs/DEVELOPING_ADAPTERS.md) — the step-by-step walkthrough, with a complete worked example.
2. [`docs/ADAPTER_SPEC.md`](./docs/ADAPTER_SPEC.md) — the normative contract, and the reasoning behind each rule.
3. [`docs/CHAIN-SUPPORT-MATRIX.md`](./docs/CHAIN-SUPPORT-MATRIX.md) — what's actually supported today, and what each unsupported network would need.

The short version:

- Implement `MonitoredChainAdapter` (`src/engine/chains/chain-adapter.ts`). You do **not** need to inherit from `EvmAdapter` — if your network isn't EVM, you shouldn't.
- Run the reusable conformance suite (`describeAdapterConformance`) plus your own decoding tests. Both must pass offline, with no credentials.
- Add one row to `src/engine/chains/chain-registry.ts`. Start at `supportStatus: "experimental"` — that's the accurate description of code that has never touched the real network, not a demotion.
- Add your row to the support matrix in the same PR.

**You shouldn't have to modify `monitor.ts`, `detection-rules.ts`, or anything under `/alerts`, `/privacy` or `/dashboard`.** If you do, that's a finding about the architecture rather than something to work around — open an issue describing it. Those reports are more useful to the project than the workaround would be.

Two rules that are non-negotiable for adapters, both enforced by the conformance suite:

- **Read-only.** No private key, mnemonic, signer or wallet, and no transaction-sending path. Adapters receive an address and nothing else — never a phone number, email, user ID or threshold.
- **Network failure must propagate.** Never return `0n` or a cached value when a read fails. A monitor that looks healthy and sees nothing is the worst failure this product can have, and swallowing an RPC error is the usual way to build one.

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
