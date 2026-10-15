# VILIGION

> On-chain treasury monitoring for the Tempo blockchain, with phone-call alerting for when the owner isn't watching a dashboard — and privacy protection designed against physical attacks ("wrench attacks").

Built for the **Crypto World's Fair** hackathon (Colosseum), **Tempo** track.

> ### Submission snapshot — what the judges are evaluating
>
> The hackathon submission deadline was **2026-10-13 06:59 UTC**. Everything the submission claims refers to the tree tagged **[`submissao-colosseum-2026-10-13`](https://github.com/JefersonCruz/VILIGION/releases/tag/submissao-colosseum-2026-10-13)** (commit [`54c586d`](https://github.com/JefersonCruz/VILIGION/commit/54c586d), 2026-10-13 01:34 UTC — the last commit inside the window).
>
> ```bash
> git checkout submissao-colosseum-2026-10-13   # exactly what was submitted
> npm ci && npm test                            # 382 tests, 40 files
> ```
>
> **One commit on `master` is newer than that deadline, and it is not part of the submission:**
>
> | Commit | What it is |
> |---|---|
> | [`e6cf513`](https://github.com/JefersonCruz/VILIGION/commit/e6cf513) (2026-10-15) | Evaluation access for judges — a single-factor login so a reviewer, or an agent acting for one, can look at the product without setting up an authenticator app. See [`docs/JUDGE-ACCESS.md`](./docs/JUDGE-ACCESS.md). |
>
> That change adds **no product capability**: it cannot change an alert destination, cannot fire an alert, and expires on 2026-11-14. It was added after the platform's own submission review recommended reducing evaluation friction. Judging the tag rather than `master` costs nothing — the product is identical in both.
>
> Anything committed after that is ordinary post-hackathon work and is equally outside the submission.

## The problem

Business owners who receive/hold stablecoin in on-chain treasuries on Tempo have no way to know, in real time, when something falls outside the norm — a sudden balance drop, a transfer blocked by a receive policy — unless they're watching a dashboard all day. Existing monitoring tools (Hexagate, Elliptic, TRM Labs, Blockaid) are built for institutional security teams, not for an SMB owner without one.

At the same time, linking a phone number to an on-chain balance creates a real, documented risk: physical attacks tied to crypto ownership ("wrench attacks") grew more than 33% year-over-year in 2026 (CertiK), with more than $30M stolen in the first half alone (Chainalysis).

## What this project does

1. **Monitors** TIP-20 addresses on Tempo (balance and `ReceivePolicyGuard`/TIP-403 blocked-transfer events) via direct RPC (Viem) as the primary source.
2. **Detects** two event types against per-user configurable thresholds (private, never hardcoded): an abnormal balance drop inside a rolling window, and a blocked transfer above a configured amount. Statistical baselining of transfer *patterns* (z-score style) is roadmap, not built — see [`docs/PRODUCT-FEASIBILITY.md`](./docs/PRODUCT-FEASIBILITY.md).
3. **Alerts** through three channels, chosen by severity: a critical anomaly goes out by **real phone call** (Twilio Programmable Voice) and, if the owner registered a device, by **Web Push notification — no phone number involved at all**; a normal anomaly goes out by **email** (no per-message cost, no carrier call-log retention problem — see `SECURITY.md`). Content is **always generic** on every channel — never reveals balance or address, enforced by automated test rather than review.

   The push channel exists for a specific reason, and it isn't channel redundancy: a phone number is the one piece of data in the alert path that we cannot protect after the fact. It is attributable to a person, and it persists in carrier records and in Twilio's call logs — nothing in our code erases that. A push endpoint is an opaque address the browser issues and the owner can revoke, so there is no number to link to an account. The privacy property comes from the data not existing, not from stronger encryption. **Exercised end to end on a real device in production on 2026-10-12** — a test alert was delivered to a phone and the notification arrived. **Honest caveat:** it is inherently less reliable than a phone call — notably on iOS, where the app must be added to the home screen first. The two channels coexist on purpose; the more private channel is the less guaranteed one, and the owner chooses with that stated on screen.
4. **Protects the owner's identity**: proof of address ownership required at signup (EIP-191 signature); alert recipients (phone numbers and emails) are registered separately, after login, and stored with AES-256-GCM envelope encryption — never in plaintext alongside the monitored address. Two honest caveats about this line, because the threat model depends on them: the product **does not provision virtual numbers** — registering a dedicated number instead of the owner's personal one is a recommendation we make, not something the code enforces or supplies; and the encryption key today comes from `LocalDevKeyProvider`, **not a managed KMS** ([issue #9](https://github.com/JefersonCruz/VILIGION/issues/9) tracks that swap, required before any real customer data).
5. Full details (real balance, history) are only visible after dashboard authentication — never through the alert channel.

## What this project **doesn't** do (by security decision, not lack of time)

- Doesn't execute transactions from a voice/SMS reply. Any action involving funds requires full login plus the user's own wallet signature.
- Isn't a custody product. We never hold the user's private key.
- Doesn't replace institutional security tools (Hexagate, Elliptic, TRM) — it's a complement designed for owners who don't have a security team.

See [`SECURITY.md`](./SECURITY.md) for the full threat model.

## How it works (overview)

```
Detection Engine (EVM core + Tempo adapter)
        │ anomaly event (no sensitive data)
        ▼
Privacy Layer (resolves address→contact, decides what can go out)
        │ generic payload
        ▼
Delivery Layer (Twilio Voice + Web Push / email by severity)
        │
        ▼
Dashboard/Auth (full detail only after login)
```

Full technical detail in [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## Chain support — what works, and what is only registered

The detection core is network-agnostic: it depends on a published contract (`MonitoredChainAdapter`), not on any one chain's classes. A non-EVM network can be integrated without modifying the core, and there is a test that proves it by driving the unmodified monitor with a non-EVM adapter.

Being *registered* is not the same as being *supported*, so the two are tracked separately:

| Network | Verified against the real network | Status |
|---|---|---|
| **Tempo** | Yes — Moderato testnet: RPC, chain ID, Guard address cross-checked against `viem/tempo`, TIP-403 `TransferBlocked` decoding | `validating` |
| Base, Arbitrum One, Ethereum L1 | **No** — they run the generic EVM adapter, which is tested, but no one has exercised these chains specifically | `experimental` |

**No network is marked stable, and there has been no external security audit.** The per-network detail, including known limitations and what each unsupported network would require, is in [`docs/CHAIN-SUPPORT-MATRIX.md`](./docs/CHAIN-SUPPORT-MATRIX.md).

## Contributing — especially new networks

The core is generic; what's missing is networks. That's the contribution the project most wants, and it's set up to need no coordination with the maintainer: there's a documented contract, a reusable conformance test suite your adapter runs for free, and a reference adapter (Tempo) showing how to contain a protocol's quirks without spreading them into the core. Adding a network is a new module plus one registry row.

- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — environment setup, how to run the tests, the two project zones and their rules
- [`docs/DEVELOPING_ADAPTERS.md`](./docs/DEVELOPING_ADAPTERS.md) — step-by-step walkthrough with a worked example
- [`docs/ADAPTER_SPEC.md`](./docs/ADAPTER_SPEC.md) — the normative contract, and the reasoning behind each rule

Two non-negotiable rules for adapters, both enforced by the conformance suite: **read-only** (no private key, signer, or transaction-sending path) and **network failures must propagate** (never return `0n` for a read that failed — a monitor that looks healthy and sees nothing is the worst failure this product can have).

Want to propose a network? Open an issue with the "Suporte a uma nova rede" template. Contributions don't carry compensation, equity, tokens, or prizes — see [`GOVERNANCE.md`](./GOVERNANCE.md).

**Security vulnerabilities never go in a public issue.** Use the responsible disclosure process in [`SECURITY.md`](./SECURITY.md).

## Status

Project under construction for the Crypto World's Fair hackathon (submission by 2026-10-13). See [`docs/TEAM-PLAYBOOK.md`](./docs/TEAM-PLAYBOOK.md) for how the team works (roles, communication channels and what is never asked on them, available tooling), [`GOVERNANCE.md`](./GOVERNANCE.md) for how decisions are made at this stage, [`docs/BUSINESS-PLAN.md`](./docs/BUSINESS-PLAN.md) for the phased business and development plan, [`docs/PRODUCT-FEASIBILITY.md`](./docs/PRODUCT-FEASIBILITY.md) for the effort/risk/impact study behind what gets built next, [`docs/VIDEO-SCRIPT.md`](./docs/VIDEO-SCRIPT.md) for the submission video script, [`docs/UI-SPEC.md`](./docs/UI-SPEC.md) for the portal/dashboard structure, [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) for how to host it, and [`TERMS-OF-USE.md`](./TERMS-OF-USE.md) for the service's terms (draft, pending legal review — see the notice at the top of that file). There's also an internal Contributor Agreement covering hackathon prize money and future equity intentions, shared privately with signed-in contributors only — not published in this public repo (see `docs/signatures/README.md` for the public, non-financial record of who signed).

## Try it live

The product is live at **https://viligion.com**. It watches a test wallet on the Tempo **Moderato testnet** — no real funds involved.

**Judges and reviewers:** demo credentials are in the hackathon submission form, which is private to you. If you are reviewing outside that channel, open an issue and we will share access.

Credentials are deliberately **not published here.** A shared account whose password and TOTP secret sit in a public README is not a demo account, it is a credential leak — and this repository belongs to a product whose `SECURITY.md` promises never to store credentials in plaintext. Publishing them would contradict the same page a reviewer reads to judge the work. It would also let any visitor register an alert recipient and trigger real phone calls on our Twilio account.

The demo holds synthetic data only. See [`SECURITY.md`](./SECURITY.md) for why personal alert data never works this way in a real deployment.

## License

MIT — see [`LICENSE`](./LICENSE).
