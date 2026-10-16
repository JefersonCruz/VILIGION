# Chain Support Matrix

What is actually supported, how far each network has been verified, and who is responsible for it.

**Being listed here does not mean production support.** This file exists because a registered network name is not a supported network — that distinction was the central finding of the architecture audit, and this table is how the project keeps itself honest about it.

Last updated: 2026-10-12. Status definitions are in [`ADAPTER_SPEC.md` §7](./ADAPTER_SPEC.md#7-what-a-network-needs-before-it-is-called-stable); the machine-readable source is `supportStatus` in [`chain-registry.ts`](../src/engine/chains/chain-registry.ts), and a test asserts the two agree.

---

## Current state

| Network | Adapter | Implemented | Verified against real network | Environment | Known limitations | Maintainer | Status |
|---|---|---|---|---|---|---|---|
| **Tempo** | `TempoAdapter` (extends `EvmAdapter`) + `TempoBlockedTransferExtension` | TIP-20 balance via `balanceOf`; `TransferBlocked` (TIP-403) decoding; ClaimReceiptV1 witness decoding via `ox/tempo`; fee classification against the FeeManager precompile; log pagination; confirmation depth | Yes — `scripts/verify-testnet.ts` against Moderato testnet: RPC reachable, chain ID, `RECEIVE_POLICY_GUARD_ADDRESS` cross-checked against `Addresses.receivePolicyGuard` from `viem/tempo`, `TransferBlocked` decoding exercised | Moderato testnet (chain ID 42431). Mainnet chain ID 4217 is configured but **not** exercised | No reorg-rewind handling (forward-only cursor); events older than `maxHistoryWindow` are dropped after a long outage, by design; `eth_getBalance` is meaningless here, so `tokenAddress` is mandatory | @JefersonCruz | **validating** |
| **Base** | `EvmAdapter` (generic) | ERC-20 and native balance; log pagination; confirmation depth | **Monitoring path yes** (2026-10-16, see below); `eth_getLogs` **no** | Base mainnet via public RPC | Never exercised against Base. Default public RPC is a development convenience, not a production endpoint. Fee classification is a no-op, which is correct for a chain with a real native gas token but untested here | *none declared* | **experimental** |
| **Arbitrum One** | `EvmAdapter` (generic) | Same as Base | **Yes** (2026-10-16, see below) | Arbitrum One mainnet via public RPC | Same as Base. Arbitrum's finality model differs from L1's; the generic confirmation depth of 3 has not been justified for it | *none declared* | **experimental** |
| **Ethereum L1** | `EvmAdapter` (generic) | Same as Base | **Monitoring path yes** (2026-10-16, see below); `eth_getLogs` **no** | Ethereum mainnet via public RPC | Same as Base. A confirmation depth of 3 is likely too shallow for L1 treasury-grade monitoring and has not been reviewed | *none declared* | **experimental** |

No network is `stable`. Tempo is the only one with any real-network evidence.

---

## First real-network run — 2026-10-16

Until this date the three EVM chains had **never been exercised against their real networks**. `scripts/verify-chain.ts` now does that for any registered EVM chain, and the first run produced the table below. Reproduce with `npx tsx scripts/verify-chain.ts --chain base`.

| Check | Base | Arbitrum One | Ethereum L1 |
|---|---|---|---|
| RPC reachable | pass | pass | pass |
| chain ID matches the registry | pass (8453) | pass (42161) | pass (1) |
| Balance read through the registry's adapter | pass | pass | pass |
| Confirmed cursor respects declared depth | pass | pass | pass |
| `eth_getLogs` pagination | **fail** | pass (51k blocks) | **fail** |

**The monitoring path works on all three.** That is the part that matters for what VILIGION actually does on a generic EVM chain: `Monitor.tick` reads a balance and a cursor, and `getConfirmedLogs` only runs when a chain has a protocol extension — which only Tempo has.

**What the log failures mean, per chain:**

- **Base** (`https://mainnet.base.org`): refuses `eth_getLogs` for anonymous callers with `request limit reached`. **Not a window-size problem** — probed at 10, 1 000, 10 000 and 50 000 blocks and all four failed. The declared capability `historicalEvents: true` is therefore **not true with this RPC**, and any future protocol extension on Base will need a dedicated provider.
- **Ethereum L1** (`https://ethereum-rpc.publicnode.com`): `Invalid parameters` on a 51 000-block range — the classic provider range cap. A smaller window would likely work; the exact limit was not measured.
- **Arbitrum One** (`https://arb1.arbitrum.io/rpc`): handled 51 000 blocks without complaint.

This is the concrete form of the warning already in this file: the default public RPCs are a development convenience, not production endpoints.

**Status unchanged — all three stay `experimental`.** Per [`ADAPTER_SPEC.md` §7](./ADAPTER_SPEC.md#7-what-a-network-needs-before-it-is-called-stable), `validating` also requires a justified confirmation depth for that network and a declared maintainer. Neither exists yet. A successful run is an instant, not a history.

## What "experimental" means here, concretely

Base, Arbitrum and Ethereum L1 share the generic `EvmAdapter`, which does have real test coverage: pagination against provider range limits, the full conformance suite, and the balance/cursor logic. The code is not speculative.

What is missing is specific to each network: nobody has run VILIGION against Base and confirmed that a balance read returns the expected number for a known address, that the chosen confirmation depth is appropriate for that chain's reorg behaviour, or that the public RPC default behaves under sustained polling.

That gap is small for an EVM chain and genuinely easy to close — which is part of why it is a good first contribution. It is also exactly the gap that, left undeclared, turns into "VILIGION supports 4 chains" in a pitch deck and an unprotected treasury in reality.

---

## What the chains say about their own finality — measured 2026-10-16

`scripts/verify-chain.ts` now reads each chain's own `safe` and `finalized` block tags and compares them with the depth we declare. The result is the same on all three, and it is not flattering:

| Chain | `safe` is behind `latest` by | `finalized` by | What our declared depth of 3 buys |
|---|---|---|---|
| Base | ~7–21 blocks (14–42 s) | ~471 blocks (~16 min) | **~6 s** |
| Arbitrum One | ~2 400–2 600 blocks (~11–12 min) | ~3 900 blocks (~17 min) | **~0.75 s** |
| Ethereum L1 | ~45–50 blocks (9–10 min) | ~77 blocks (~15 min) | **~36 s** |

**A depth of 3 blocks is shallower than what every one of these chains itself considers still-reversible.** On Arbitrum it is roughly three orders of magnitude shallower. So the honest reading is not "3 is a bit low" — it is that *counting blocks is the wrong instrument here*, and the number was never measuring what it appeared to measure.

**Why simply raising it is not the fix.** Waiting for `safe` would delay a critical alert by ~11 minutes on Arbitrum and ~10 on Ethereum. The product exists to tell an owner their treasury is being drained; eleven minutes of silence is a real cost, paid in the exact scenario the product is for. Depth trades a false alert against a late one, and for this product the late one is worse.

That points at the gap already recorded in [`ARCHITECTURE.md`](../ARCHITECTURE.md) → "Still open": **reorg rewind**. Alerting early and retracting an event that later disappears is a better shape for this product than alerting slowly. Until that exists, the depth stays as it is and `confirmationJustified` stays `false` on every chain — now for a measured reason rather than an unexamined one.

## Confirmation depth

Every network currently runs at **3 confirmations**, and **none of those values has been justified for the network it applies to.** That gap is now declared in code (`confirmationJustified: false` in `chain-registry.ts`) and warned about at boot, rather than sitting invisible in four hardcoded call sites as it did before.

| Network | Depth | Justified? | Why that value |
|---|---|---|---|
| **Tempo** | 3 | **No** | It is the depth Tempo was actually exercised with against the Moderato testnet, so it is not an arbitrary number — but it is not derived from the network's finality model either, because that analysis has not been done. Working on a testnet is not the same as being the right depth for a mainnet treasury. |
| Base, Arbitrum One | 3 | **No** | Inherited default, never analysed. Worse than it looks for an L2: a block already "confirmed" on the L2 can still be reverted if the corresponding L1 batch reorganises, so counting L2 blocks does not measure the actual risk. |
| Ethereum L1 | 3 | **No** | Inherited default, never analysed. Likely too shallow for treasury-grade monitoring. |

**Why the numbers were not simply raised:** choosing a depth is a product decision before it is a technical one. Deeper confirmation reduces false alerts from reorgs but *delays the warning* — and in a product whose job is to tell an owner their treasury is being drained, alert latency is a real cost, not a detail. Replacing 3 with a number nobody can justify against each network's measured behaviour would be inventing precision.

Closing this gap per network means: measuring that network's reorg depth distribution, deciding the acceptable alert-latency cost, writing the rationale, and flipping `confirmationJustified` to `true` — which a test enforces must happen together with updating this table.

## Not supported, and what each would need

Listed because they come up, not because work is underway.

| Network | Family | Why it is not just "another RPC URL" |
|---|---|---|
| **Solana** | `svm` | No `eth_getLogs`; slots rather than blocks; balances live in accounts, and SPL token balances in separate token accounts that do not map onto `balanceOf`; different finality model (`processed`/`confirmed`/`finalized`); historical event access generally needs an indexer, which conflicts with keeping third parties off the critical alert path. Needs a `MonitoredChainAdapter` written from scratch. |
| **Hyperliquid** | `other` | Order-book and perp semantics; "balance" is not a single ERC-20 reading. Needs its own event model before an adapter makes sense. |
| **Zcash** | `other` | Shielded pools mean balances are deliberately unobservable without a viewing key. Monitoring a shielded address would require handling viewing-key material, which collides head-on with the read-only, no-key rule in [`ADAPTER_SPEC.md` §6](./ADAPTER_SPEC.md#6-security-requirements). That tension needs a design decision before any code. |

Solana is the intended first independent integration — see the roadmap in [`ARCHITECTURE.md`](../ARCHITECTURE.md). It was chosen because it is far enough from EVM to genuinely test whether the contract is network-agnostic, which a fifth EVM chain would not.

---

## Adding a row

Open a PR that adds the integration and its row together. Both move in the same change — a row describing code that is not merged, or code with no row, is how this table stops being trustworthy.

- Tutorial: [`DEVELOPING_ADAPTERS.md`](./DEVELOPING_ADAPTERS.md)
- Rules: [`ADAPTER_SPEC.md`](./ADAPTER_SPEC.md)
- Fill in the limitations column honestly. An empty limitations cell reads as "nobody looked", not "no limitations".
