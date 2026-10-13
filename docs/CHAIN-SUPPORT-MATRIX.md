# Chain Support Matrix

What is actually supported, how far each network has been verified, and who is responsible for it.

**Being listed here does not mean production support.** This file exists because a registered network name is not a supported network — that distinction was the central finding of the architecture audit, and this table is how the project keeps itself honest about it.

Last updated: 2026-10-12. Status definitions are in [`ADAPTER_SPEC.md` §7](./ADAPTER_SPEC.md#7-what-a-network-needs-before-it-is-called-stable); the machine-readable source is `supportStatus` in [`chain-registry.ts`](../src/engine/chains/chain-registry.ts), and a test asserts the two agree.

---

## Current state

| Network | Adapter | Implemented | Verified against real network | Environment | Known limitations | Maintainer | Status |
|---|---|---|---|---|---|---|---|
| **Tempo** | `TempoAdapter` (extends `EvmAdapter`) + `TempoBlockedTransferExtension` | TIP-20 balance via `balanceOf`; `TransferBlocked` (TIP-403) decoding; ClaimReceiptV1 witness decoding via `ox/tempo`; fee classification against the FeeManager precompile; log pagination; confirmation depth | Yes — `scripts/verify-testnet.ts` against Moderato testnet: RPC reachable, chain ID, `RECEIVE_POLICY_GUARD_ADDRESS` cross-checked against `Addresses.receivePolicyGuard` from `viem/tempo`, `TransferBlocked` decoding exercised | Moderato testnet (chain ID 42431). Mainnet chain ID 4217 is configured but **not** exercised | No reorg-rewind handling (forward-only cursor); events older than `maxHistoryWindow` are dropped after a long outage, by design; `eth_getBalance` is meaningless here, so `tokenAddress` is mandatory | @JefersonCruz | **validating** |
| **Base** | `EvmAdapter` (generic) | ERC-20 and native balance; log pagination; confirmation depth | **No** | — | Never exercised against Base. Default public RPC is a development convenience, not a production endpoint. Fee classification is a no-op, which is correct for a chain with a real native gas token but untested here | *none declared* | **experimental** |
| **Arbitrum One** | `EvmAdapter` (generic) | Same as Base | **No** | — | Same as Base. Arbitrum's finality model differs from L1's; the generic confirmation depth of 3 has not been justified for it | *none declared* | **experimental** |
| **Ethereum L1** | `EvmAdapter` (generic) | Same as Base | **No** | — | Same as Base. A confirmation depth of 3 is likely too shallow for L1 treasury-grade monitoring and has not been reviewed | *none declared* | **experimental** |

No network is `stable`. Tempo is the only one with any real-network evidence.

---

## What "experimental" means here, concretely

Base, Arbitrum and Ethereum L1 share the generic `EvmAdapter`, which does have real test coverage: pagination against provider range limits, the full conformance suite, and the balance/cursor logic. The code is not speculative.

What is missing is specific to each network: nobody has run VILIGION against Base and confirmed that a balance read returns the expected number for a known address, that the chosen confirmation depth is appropriate for that chain's reorg behaviour, or that the public RPC default behaves under sustained polling.

That gap is small for an EVM chain and genuinely easy to close — which is part of why it is a good first contribution. It is also exactly the gap that, left undeclared, turns into "VILIGION supports 4 chains" in a pitch deck and an unprotected treasury in reality.

---

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
