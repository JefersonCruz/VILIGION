# Contributing

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

(to be filled in once the final setup is settled: Tempo's Moderato testnet, a trial Twilio account, required environment variables)

## Reporting bugs vs. security vulnerabilities

Regular bug → public issue. Security vulnerability → see the responsible disclosure process in [`SECURITY.md`](./SECURITY.md), never a public issue.
