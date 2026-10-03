# Governance

## Current phase: pre-launch (hackathon)

This project was born for Colosseum's Crypto World's Fair hackathon. At this stage, technical and product decisions are made by the founding team listed in [`CONTRIBUTING.md`](./CONTRIBUTING.md). There's no formal voting process yet — it wouldn't make sense to simulate governance that doesn't really exist just to look mature.

## Declared evolution goal

If the project continues after the hackathon (especially if the TIP-403/`ReceivePolicyGuard` decoder gets adopted by other builders in the Tempo ecosystem), the intent is to migrate to:

1. **Issues and PRs open to any contributor**, with acceptance criteria documented in `CONTRIBUTING.md`.
2. **Relevant technical decisions discussed publicly** (GitHub Discussions or equivalent), not decided privately.
3. Evaluate formalizing a review process requiring more than one person to approve changes to the security/privacy layer (`/privacy`, `/alerts`), given the elevated risk of those areas.

## Future roles (once there's traction to justify them — see `docs/BUSINESS-PLAN.md`)

Two roles identified from real architecture gaps (see `ARCHITECTURE.md` → "Architecture gaps"), not generic placeholders — each has a concrete problem owner:

**R&D Agent**
Responsibility: keep the project's assumptions about Tempo up to date, formalizing as a recurring process what was done manually during this investigation (confirming RPC/chain ID, the `ReceivePolicyGuard` address, the ABI, and the discovery that `ox`/`viem/tempo` already cover parts of the protocol) — not a one-off event. Tempo itself warns that TIP-403 and the Indexer API "are still evolving" — someone needs to periodically re-verify this against the official docs and the real network (`scripts/verify-testnet.ts` is the natural starting point to automate this, e.g. running it as a scheduled job and alerting if something stops matching).

**Data Scientist**
Responsibility: calibrate detection thresholds with real data instead of a guessed constant, and close the `classifyBalanceDelta` gap (today a stub that never filters out a fee from a real value transfer). Since Tempo has no native gas token, every transaction deducts a fee from the same monitored balance — without a real statistical model of "what's a typical fee-deduction size," the system can't tell operational noise apart from a genuine anomaly. First concrete deliverable: collect transaction history from real addresses on Tempo and define, with data, what counts as "fee-sized" vs. "an actual outflow of value."

## What doesn't change regardless of governance

The rules in `SECURITY.md` (never reveal balance/address in an alert, never hold a private key, never authorize a transaction from a voice/SMS reply) are treated as **project invariants**, not subject to roadmap decisions — changing these would require rewriting the entire threat model, it isn't a normal feature.

## Licensing

MIT. Any fork or commercial use is permitted under the license terms; there's no obligation to contribute back, but it's encouraged.
