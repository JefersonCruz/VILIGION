# Developing a Chain Adapter

A walkthrough for adding support for a new network. Read [`ADAPTER_SPEC.md`](./ADAPTER_SPEC.md) for the normative rules; this file is the practical path through them.

Expect a first working adapter in an afternoon if your network is EVM-compatible, and considerably longer if it is not — most of that time spent on your network's event semantics, not on VILIGION.

---

## 0. Set up

Node.js 20+. No database, no credentials, no network access needed for any of this.

```bash
git clone https://github.com/JefersonCruz/VILIGION.git
cd VILIGION
npm install
npm test
```

`npm test` should pass on a fresh clone. If it does not, that is a bug worth an issue before you write anything — you want a known-good baseline to compare against.

Two commands you will run constantly:

```bash
npm test                              # full suite
npx tsc -p tsconfig.json --noEmit     # typecheck
```

CI runs both. Run them locally first.

---

## 1. Decide what kind of integration you are writing

**Is your network EVM-compatible?**

**Yes, and it behaves like a normal EVM chain** (real native gas token, standard `eth_getLogs`, ERC-20 `balanceOf`): you may not need a new adapter class at all. Add an entry to `KNOWN_CHAINS` plus a registry entry using the generic path, write tests, and document what you verified. Look at how `base` is wired in `chain-registry.ts`.

**Yes, but it has protocol quirks** (fees paid in the monitored token, non-reverting blocked transfers, custom events): subclass `EvmAdapter`, override what differs, and add a `ChainExtension` for your protocol events. `TempoAdapter` is the reference.

**No:** implement `MonitoredChainAdapter` directly. You do not need to inherit from anything, and you should not import `viem` beyond the `Address` type. `FakeSlotChainAdapter` in `adapter-conformance.test.ts` is a complete non-EVM implementation — it is a test fixture, but it is a real example of the shape.

> **Do not assume the EVM adapter is reusable for a non-EVM network.** Solana is the clearest case: no `eth_getLogs`, slots rather than blocks, accounts rather than contract-held balances, a different finality model, and SPL token accounts that do not map onto `balanceOf`. Treating it as "EVM with a different RPC" produces an adapter that compiles and silently does not work.

---

## 2. Write the adapter

Minimal non-EVM skeleton:

```ts
import type { Address } from "viem";
import type {
  AdapterMetadata,
  BalanceSnapshot,
  ChainCapabilities,
  MonitoredChainAdapter,
} from "./chain-adapter.js";

export class MyChainAdapter implements MonitoredChainAdapter {
  readonly metadata: AdapterMetadata = {
    chainKey: "minharede",
    displayName: "Minha Rede",
    family: "other",
    // no chainId: this family has no such concept
  };

  readonly capabilities: ChainCapabilities = {
    tokenBalance: true,
    nativeBalance: false,       // see note below
    historicalEvents: true,
    feePaidInMonitoredAsset: false,
    reorgPossible: false,       // deterministic finality
    requiresTokenAddress: true,
  };

  /** Largest cursor range this network's provider accepts in one query. */
  readonly maxHistoryWindow = 1_000n;

  constructor(private readonly config: MyChainConfig) {
    // Reject invalid config HERE, not on first read. A monitor that looks
    // healthy and sees nothing is the worst failure mode this product has.
    if (!config.tokenAddress) {
      throw new UnsupportedCapabilityError(
        "minharede",
        "nativeBalance",
        "this network has no meaningful native balance, so tokenAddress is required",
      );
    }
  }

  async getBalance(address: Address): Promise<BalanceSnapshot> {
    const raw = await this.readTokenBalance(address); // throws on failure — do not catch
    return {
      address,
      raw,
      blockNumber: await this.currentSlot(),
      observedAt: new Date(), // local clock, not a chain timestamp
    };
  }

  async getConfirmedBlockNumber(): Promise<bigint> {
    return this.currentSlot();
  }

  async getFeeAdjustment(): Promise<bigint> {
    // Correct answer, not a placeholder: this network declares that fees do
    // not come out of the monitored asset.
    return 0n;
  }
}
```

Three things to get right from the start, because they are the ones reviewers send back:

**`observedAt` is your local clock.** Not a block timestamp. The detection window measures wall-clock time between two of *our* observations. A chain timestamp can be stale, skewed, or influenced by whoever produced the block — none of which is a sound basis for deciding whether to call someone.

**Never swallow an error.** No `try { ... } catch { return 0n }`. Ever. See §4 of the spec.

**Make every RPC call substitutable.** Put each raw call in its own small `protected` method, the way `EvmAdapter` does with `rawGetLogs`, `rawReadTokenBalance`, `rawReadNativeBalance` and `rawGetBlockNumber`. This is what lets you test the real logic offline instead of a reimplementation of it in a mock.

---

## 3. Normalize your protocol events

Only if your network has protocol events worth alerting on. Most do not — and an adapter with no extension is a perfectly good contribution.

Your extension translates your event into a normalized observation, then calls the generic rule:

```ts
export function toRestrictedTransferObservation(event: MyBlockedEvent): RestrictedTransferObservation {
  return {
    kind: "transfer-restricted",
    chainKey: "minharede",
    cursor: event.slot,
    sequence: event.occurrenceId,   // must identify the occurrence
    txRef: event.signature,
    amount: event.amount,
    details: {                      // preserved for audit; DATA, never command
      protocolEvent: "minharede/TransferBlocked",
      reason: event.reason,
    },
  };
}

export class MyChainRestrictedTransferExtension implements ChainExtension {
  constructor(private readonly adapter: MyChainAdapter) {}

  async checkExtra(from: bigint, to: bigint, thresholds: UserThresholds): Promise<DetectionEvent[]> {
    const events: DetectionEvent[] = [];
    for (const raw of await this.adapter.getBlockedTransfers(from, to)) {
      const event = checkRestrictedTransfer(toRestrictedTransferObservation(raw), thresholds);
      if (event) events.push(event);
    }
    return events;
  }
}
```

Use `from`/`to` as given. Do not re-ask the network for the current cursor — the monitor already computed it and passed it to you precisely so you do not duplicate that call.

If your event does not fit any normalized kind, do not bend it to fit. Use `ProtocolSpecificObservation<YourType>`, keep the rule in your extension, and document why in your PR. Forcing false equivalence between networks is a worse outcome than an extra observation type.

---

## 4. Register it

One entry in `src/engine/chains/chain-registry.ts`:

```ts
minharede: {
  chainKey: "minharede",
  displayName: "Minha Rede",
  family: "other",
  supportStatus: "experimental",   // see below
  maintainer: "@seu-handle",       // or null
  validationEvidence: "Deterministic tests only. Not yet exercised against the real network.",
  build: (context) => {
    const adapter = new MyChainAdapter({ ...context });
    return { adapter, extension: new MyChainRestrictedTransferExtension(adapter) };
  },
},
```

**Start at `experimental`.** It is not a demotion, it is the accurate description of code that has never touched the real network. Moving to `validating` needs recorded evidence from a real run — see §7 of the spec and the matrix.

`validationEvidence` should say what you actually did. "Ran against Sepolia on 2026-11-02, confirmed RPC, chain ID and balance decoding against a known address" is useful. "Tested and working" is not, and a reviewer will ask you to replace it.

**`maintainer: null` is an honest answer** if you are contributing a one-off and cannot commit to maintaining it. Say so in the PR. It affects what status the integration can reach, not whether it is welcome.

Nothing else in the core needs to change. If it does, that is a finding — report it.

---

## 5. Test it

### Conformance suite — free, and required

```ts
import { describeAdapterConformance } from "./adapter-conformance.js";

describeAdapterConformance({
  label: "MyChainAdapter",
  sampleAddress: "0x...",
  expectedBalance: 1_234n,
  create: () => new OfflineMyChainAdapter(),
  createFailing: () => new FailingMyChainAdapter(),
});
```

`createFailing()` is required, not optional. It returns an adapter whose every network call throws, and it exists to prove your adapter propagates failure instead of inventing a balance. That single property is the most important thing the suite checks.

Both fixtures must work with no network and no credentials.

### Your own tests

Conformance checks the *contract*. It cannot check whether you decoded your network's events correctly — that is specific to your protocol and needs your own fixtures. `tempo.adapter.test.ts` is the example to follow: real log payloads, deterministic, offline.

Cover at minimum:

- Decoding a real event payload correctly
- Ignoring logs that are not your event (normal — contracts emit other things)
- Invalid or malformed RPC responses
- Pagination, and resumption after an interrupted run
- Duplicate events, and events out of sequence order
- Confirmation depth / reorg handling, if `reorgPossible`
- Missing or invalid configuration
- Fee classification, if `feePaidInMonitoredAsset`

### Real-network tests stay separate

Anything that touches a real network goes in `scripts/`, like `verify-testnet.ts` — never in the `npm test` suite. The suite must stay deterministic and runnable offline by anyone.

Real-network scripts must not depend on personal credentials or private endpoints. Public testnet RPC and a faucet, or it does not belong in the repository.

### Do not fake a pass

No `as any` to silence a type error, no mock so permissive it would accept a broken adapter, no test that asserts a function was called without checking what it did. A test that cannot fail is worse than no test, because it buys confidence that was never earned.

---

## 6. Document the limitations

In your PR, and in the compatibility matrix:

- What you verified, how, and when
- What you did **not** verify
- Which capabilities you declared `false`, and why
- Which failure modes you know about and have not handled

A PR that says "balance reading verified against Sepolia; fee classification untested; reorg handling not implemented because this network has deterministic finality" gets reviewed quickly. A PR that says "adds support for X" sends the reviewer looking for what is missing, and they will find it.

Honest gaps are not held against a contribution. Undisclosed ones are the reason a review turns slow and uncomfortable for everyone.

---

## 7. Open the pull request

```bash
git checkout -b feat/adapter-minharede
npm test
npx tsc -p tsconfig.json --noEmit
```

Both green, then open the PR. The template asks what you verified and what you did not — answer it concretely.

Expect review to focus on:

1. Does an absent capability get declared, or faked?
2. Does network failure propagate?
3. Is it read-only, with no access to keys or user data?
4. Do the tests run offline, and would they actually fail if the adapter broke?
5. Does the claimed support status match the evidence?

Changes under `src/privacy/`, `src/alerts/` or `src/dashboard/` need additional review and a security rationale — see [`CONTRIBUTING.md`](../CONTRIBUTING.md). A chain adapter should not touch those paths at all; if yours does, explain why before writing it.

**Security vulnerabilities never go in a public issue or PR.** See [`SECURITY.md`](../SECURITY.md).

---

## Reference files

| File | What it shows |
|---|---|
| [`chain-adapter.ts`](../src/engine/chains/chain-adapter.ts) | The contract, with the reasoning inline |
| [`evm-adapter.ts`](../src/engine/chains/evm-adapter.ts) | Generic EVM core; internal pagination; test seams |
| [`tempo.adapter.ts`](../src/engine/chains/tempo.adapter.ts) | A network with real quirks, and how they are contained |
| [`tempo-extension.ts`](../src/engine/chains/tempo-extension.ts) | Protocol event → normalized observation |
| [`normalized-events.ts`](../src/engine/rules/normalized-events.ts) | The normalized model and its rules |
| [`adapter-conformance.ts`](../src/engine/chains/adapter-conformance.ts) | The reusable suite |
| [`adapter-conformance.test.ts`](../src/engine/chains/adapter-conformance.test.ts) | A complete non-EVM adapter |
| [`chain-registry.ts`](../src/engine/chains/chain-registry.ts) | Where an integration is declared |
