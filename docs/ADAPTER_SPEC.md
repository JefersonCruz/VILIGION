# Chain Adapter Specification

The normative contract a chain integration must satisfy to be monitored by VILIGION's core. If you want the step-by-step tutorial instead, read [`DEVELOPING_ADAPTERS.md`](./DEVELOPING_ADAPTERS.md) and come back here for the rules.

Source of truth is the code, not this file. Where they disagree, [`src/engine/chains/chain-adapter.ts`](../src/engine/chains/chain-adapter.ts) wins and this document is a bug.

---

## 1. The five responsibilities, and why they are separate

A single class that reads a chain, decodes a protocol, decides what is risky, delivers an alert and holds user settings is a class nobody outside the project can safely change. VILIGION splits them:

| Layer | Where it lives | What it may know |
|---|---|---|
| **A. Chain adapter** | `engine/chains/*.ts` | How to read one network. Nothing about users, thresholds, or alerts. |
| **B. Protocol decoder / extension** | `engine/chains/*-extension.ts` | One protocol's events, plus how to express them as normalized observations. |
| **C. Detection rules** | `engine/rules/*.ts` | Normalized observations and user thresholds. No network-specific types. |
| **D. Alert delivery** | `alerts/*.ts` | A `DetectionEvent`. Never a balance, address or amount in message content. |
| **E. Monitoring policy / user config** | `dashboard/*.ts`, `db/*.ts` | Per-user settings. Never hardcoded in A–D. |

**If you are contributing a network, you write A and (only if your protocol needs it) B.** You should not need to modify C, D, E or `monitor.ts`. If you find yourself having to, that is a finding about the architecture — open an issue describing it rather than working around it. Those reports are more valuable to the project than the workaround.

---

## 2. The contract

```ts
interface MonitoredChainAdapter {
  readonly metadata: AdapterMetadata;
  readonly capabilities: ChainCapabilities;
  readonly maxHistoryWindow: bigint;

  checkAddress(raw: string): AddressCheck;
  getBalance(address: ChainAddress): Promise<BalanceSnapshot>;
  getConfirmedBlockNumber(): Promise<bigint>;
  getFeeAdjustment(fromBlock: bigint, toBlock: bigint, address: ChainAddress): Promise<bigint>;
  close?(): Promise<void>;
}
```

Four methods. That is deliberate — it is what `monitor.ts` calls per cycle, plus the one thing the product needs before a cycle can exist: knowing whether a typed address belongs to your network. Anything else your network can do belongs in your own adapter's public surface or in a `ChainExtension`, not in this interface.

### `checkAddress` — required

`ChainAddress` is `string`, not viem's `Address`. Until 2026-10-23 it *was* viem's `Address` (`0x${string}`), and that single type was enough to make this whole specification a dead end for any non-EVM chain: a base58 Solana address cannot satisfy `0x${string}`, and the account form validated with viem's `isAddress` directly. An adapter could pass every test in the conformance suite and still be unusable, because there was nowhere in the product to type its addresses.

So address validation is part of the contract. Rules:

| Rule | Why |
|---|---|
| **Required, not optional** | An optional method with a permissive default would weaken a security control to make integration easier. A missing `checkAddress` must fail to compile, not silently accept anything. |
| **Synchronous** | It is a format check, not an existence check. If it were async, an adapter could query the network while validating a form — and then an RPC outage would stop an owner from *registering* the account they want watched. |
| **Returns a reason on failure** | The string is shown to whoever typed the address. "must be 0x followed by 40 hex digits" is useful; "invalid address" is not. Only your network knows which sentence is right. |
| **Returns a `normalized` form on success** | The product stores the normalized form, so two spellings of one address cannot become two monitored accounts with two monitors and two phone calls for one event. |
| **Normalizing twice gives the same result** | The conformance suite checks this. It catches a normalization that produces something the same validator would reject — for example validating with a mandatory checksum but normalizing to lowercase. |
| **Never touches the network** | The suite verifies this by running `checkAddress` on the `createFailing()` adapter, whose RPC is dead by construction. |

**Do not assume case-insensitivity.** EVM addresses are hex and can be lowercased safely; base58 addresses are case-sensitive, and lowercasing two distinct Solana addresses can collapse them into one. Normalization is per-network, which is exactly why it lives here.

Your registry entry in `chain-registry.ts` also declares `checkAddress`, because the account form must validate before any adapter is built (building one needs a configured RPC URL, and a missing RPC must not block registration). **Point both at the same function** — `chain-registry.test.ts` verifies, for every registered network, that the registry and the built adapter validate identically. Two copies of one rule become two rules, and the divergence shows up as "the form accepted it and the monitor rejects it".

### `metadata`

| Field | Rule |
|---|---|
| `chainKey` | Stable, lowercase, used as the DB value in `monitored_accounts.chain_key`. Changing it later breaks existing user accounts, so pick it once. |
| `displayName` | What a user sees. |
| `family` | `"evm"`, `"svm"`, or `"other"`. Tells a reviewer whether the generic EVM core is reusable for you. |
| `chainId` | EVM chain ID. **Omit it** if your family has no such concept. Do not invent a number to fill the field. |

### `capabilities`

Declares what your adapter can and cannot observe. Every field is load-bearing:

| Capability | Meaning |
|---|---|
| `tokenBalance` | Can read an issued asset's balance (`balanceOf` or equivalent). |
| `nativeBalance` | Can read the chain's native currency balance **meaningfully**. |
| `historicalEvents` | Can enumerate past events over a cursor range. |
| `feePaidInMonitoredAsset` | Transaction fees come out of the *same* asset being monitored. |
| `reorgPossible` | The chain can reorganize, so confirmation depth matters. |
| `requiresTokenAddress` | `tokenBalance` is useless without a configured token address. |

### `maxHistoryWindow`

The largest cursor range your network accepts in one history query. It lives on the adapter, not in the core, because it is a property of your provider and protocol. Tempo's RPC rejects `eth_getLogs` ranges above 100,000 blocks; VILIGION's generic EVM adapter uses 50,000 as a safety margin. Your network's number is yours to determine and document.

---

## 3. Declaring an absent capability

**Returning a plausible-looking value for something you cannot actually observe is the most damaging mistake an adapter can make, and it is why `capabilities` exists.**

The failure chain is short. Your adapter cannot really read the monitored balance, but returns `0n` anyway. The core compares `0n` against the previous reading and sees a 100% drop — or, if it has no previous reading, sees no movement at all. Either way, the user's dashboard says the account is monitored. It is not. They will find out when they lose money.

So:

- **Cannot read it?** Declare `false` and throw `UnsupportedCapabilityError` if someone calls it anyway.
- **Reading it returns a number that does not mean what the caller thinks?** Declare `false`. Tempo does this for `nativeBalance`: `eth_getBalance` answers on the real network, but Tempo has no native gas token, so the number is unrelated to the TIP-20 treasury balance. A capability that answers with an irrelevant value is worse than an absent one.
- **Config missing that makes a declared capability impossible?** Throw in the constructor, not on first read. `TempoAdapter` rejects a missing `tokenAddress` at construction time, while whoever configured it is still looking.

`false` is a legitimate, documented answer. It is never a thing to be embarrassed about or papered over.

---

## 4. Error handling

### Network failure must propagate

`getBalance` and `getConfirmedBlockNumber` **must throw** on RPC failure. Never return `0n`, a cached value, or a guess.

The core already handles a thrown error well: it logs it, increments a consecutive-failure counter, calls `onUnhealthy` after three in a row, keeps the previous threshold values, and retries next cycle. What it cannot handle is a failure that was never reported as one.

The conformance suite enforces this, which is why `createFailing()` is a required part of a conformance subject rather than an optional one.

### Distinguish "cannot" from "is down"

Throw `UnsupportedCapabilityError` for "this network does not do that" — it never improves with a retry. Throw anything else for transient failures. A caller that cannot tell them apart either retries forever or gives up too early.

### RPC rate limits and large ranges

Paginate internally. A caller asking for a range larger than `maxHistoryWindow` should get a correct answer assembled from several provider calls, not an error — `EvmAdapter.getConfirmedLogs` is the reference implementation of this, and it exists because a single oversized query failed permanently in production (issue #8).

Do not add a retry-with-backoff loop inside the adapter without discussing it first: the core's cycle *is* the retry loop, and two independent retry layers interact in ways that are hard to reason about during an incident.

### `getFeeAdjustment` must never return a negative

The core **adds** this value to the current balance before comparing. A negative turns into a phantom balance drop, which turns into a phone call at 3am about nothing. Return `0n` when there is no adjustment, and clamp.

`0n` is the *correct* answer — not a placeholder — when `feePaidInMonitoredAsset` is `false`.

---

## 5. Event normalization

Detection rules must not import your network's types. The translation happens in your extension. See [`normalized-events.ts`](../src/engine/rules/normalized-events.ts) and `tempo-extension.ts` as the worked example.

Rules for the normalized model:

1. **Do not force semantic equivalence.** A field only belongs in the normalized model if it means the *same thing* in every network that fills it. When it does not, keep it in `details` and put the network-specific rule in your extension.
2. **Preserve the original in `details`** for audit and diagnosis.
3. **`details` is data, never a command.** It comes from the chain — which means from anyone who can emit an event, including whoever is attacking the monitored account. Nothing in `details` may decide severity, select an alert channel, become message text sent to a user, or be interpolated into a log or HTML without escaping. Only the rules, from normalized fields and user thresholds, decide an alert.
4. **Semantics are part of the contract.** `transfer-restricted` means the value did *not* reach the intended recipient. If your network reverts blocked transfers instead of diverting them, do not emit this observation — there is nothing for the owner to claim and the alert would mean something different. Use a `ProtocolSpecificObservation` and document the difference.

### Deduplication and ordering

Redelivery is the normal case, not an exceptional one: the monitor re-queries a cursor range after a failed cycle, and providers return the same log twice during a reorg. `observationKey` derives a stable key; `Monitor` uses it to avoid delivering the same event twice.

Do not assume events arrive in sequence order. Providers do not guarantee log order, and reorgs change it.

If your network offers nothing that identifies an occurrence, say so (`sequence` and `txRef` both absent) rather than synthesizing a key from the cursor. A fake key silently deduplicates *distinct* events that happen to share a cursor — that is a swallowed alert, which is worse than a repeated one.

---

## 6. Security requirements

These are requirements, not suggestions. A PR that violates one does not get merged.

1. **Read-only.** Adapters never hold a private key, mnemonic, signer or wallet, and never implement `sendTransaction`, `signMessage`, `signTypedData` or `writeContract`. The conformance suite checks this structurally. The structural check is not a proof — it catches the honest mistake (someone parking a signer "for later"), not a malicious one. For that, the control is mandatory human review of every adapter.
2. **No access to user data.** An adapter receives an address and nothing else. Not a phone number, not an email, not a user ID, not a threshold. It has no reason to reach the `privacy/`, `alerts/` or `dashboard/` modules, and must not import from them.
3. **No secrets in code, tests or fixtures.** Not an API key, not a real RPC URL with an embedded key, not a real user address. `.env.example` carries variable names only.
4. **No dependency on private endpoints for tests.** Your deterministic tests must pass on a fresh clone with no credentials and no network. If your adapter cannot be tested that way, it cannot be reviewed by anyone but you.
5. **Declare new dependencies and justify them.** A new package in the alert path is new attack surface in the alert path.

---

## 7. What a network needs before it is called stable

Registry status is evidence-based, not intention-based. See [`CHAIN-SUPPORT-MATRIX.md`](./CHAIN-SUPPORT-MATRIX.md) for the current state of each network.

**`experimental`** — the default for everything new. Code exists and compiles. Never exercised against the real network.

- Passes `describeAdapterConformance`
- Deterministic tests for its own decoding logic
- Declared capabilities match reality
- Known limitations documented

**`validating`** — additionally:

- Ran against the real network (testnet or mainnet) with the result recorded in the repository, the way `scripts/verify-testnet.ts` does for Tempo
- Deterministic tests for failure modes: invalid RPC responses, timeouts, pagination, resumption after interruption, duplicate events, out-of-order events
- Reorg/finality semantics documented, and confirmation depth justified rather than copied
- A declared maintainer

**`stable`** — additionally:

- Ran in production long enough for the known failure modes to have appeared and been handled
- The maintainer is still responsive

No network is `stable` today. That is a statement about available evidence, not modesty.

---

## 8. Interface versioning

`MonitoredChainAdapter` is a published contract. Changes follow:

- **Adding an optional member** — minor. Existing adapters keep compiling.
- **Adding a required member, or changing a signature** — breaking. Needs a documented migration path, and every in-repo adapter updated in the same PR.
- **Adding a `ChainCapabilities` field** — breaking in practice, since every adapter must now declare it. Treated as such.

If a change to this contract is the only way to support your network, that is worth discussing in an issue before you write the code. It is a legitimate outcome, and the contract being too narrow for a real network is exactly the kind of thing the first few external integrations are meant to discover.

### Change log

**2026-10-23 — breaking.** `checkAddress` added as a required member; `BalanceSnapshot.address`, `getBalance` and `getFeeAdjustment` changed from viem's `Address` to `ChainAddress` (`string`); `ConformanceSubject` gained a required `invalidAddress`, and its `sampleAddress` is no longer typed `0x${string}`.

Migration, for an adapter outside this repo: implement `checkAddress` (see above), widen your address parameters to `ChainAddress`, narrow to your own address type at the boundary — `EvmAdapter.getBalance` is the worked example — and add `invalidAddress` to your conformance subject. Every in-repo adapter was updated in the same change.

Why it was worth breaking: this is the contract being too narrow for a real network, found exactly where §8 says it gets found. The contract was already chain-agnostic about cursors, fees, finality and native balance — `FakeSlotChainAdapter` proved a slot-based chain could drive the unmodified core — but it still typed addresses as `0x${string}`, and `server.ts` validated them with viem's `isAddress`. The practical consequence was that issue #19's Solana adapter could have been written, tested and registered, and still not been usable: there was nowhere in the product to type a base58 address.
