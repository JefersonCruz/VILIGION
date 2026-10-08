# VILIGION

> On-chain treasury monitoring for the Tempo blockchain, with phone-call alerting for when the owner isn't watching a dashboard — and privacy protection designed against physical attacks ("wrench attacks").

Built for the **Crypto World's Fair** hackathon (Colosseum), **Tempo** track.

## The problem

Business owners who receive/hold stablecoin in on-chain treasuries on Tempo have no way to know, in real time, when something falls outside the norm — a sudden balance drop, a transfer blocked by a receive policy, out-of-pattern activity — unless they're watching a dashboard all day. Existing monitoring tools (Hexagate, Elliptic, TRM Labs, Blockaid) are built for institutional security teams, not for an SMB owner without one.

At the same time, linking a phone number to an on-chain balance creates a real, documented risk: physical attacks tied to crypto ownership ("wrench attacks") grew more than 33% year-over-year in 2026 (CertiK), with more than $30M stolen in the first half alone (Chainalysis).

## What this project does

1. **Monitors** TIP-20 addresses on Tempo (balance, `ReceivePolicyGuard`/TIP-403 events, transfer patterns) via direct RPC (Viem) as the primary source.
2. **Detects** anomalies against per-user configurable thresholds (private, never hardcoded).
3. **Alerts** through two channels, chosen by severity: a critical anomaly goes out by **real phone call** (Twilio Programmable Voice); a normal anomaly goes out by **email** (no per-message cost, no carrier call-log retention problem — see `SECURITY.md`). Content is **always generic** on both channels — never reveals balance or address.
4. **Protects the owner's identity**: proof of address ownership required at signup (EIP-191 signature); alert recipients (dedicated virtual phone numbers, never the owner's personal one, plus email) are registered separately, after login, and stored encrypted via managed KMS — never in plaintext alongside the monitored address.
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
Delivery Layer (Twilio Voice)
        │
        ▼
Dashboard/Auth (full detail only after login)
```

Full technical detail in [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## Status

Project under construction for the Crypto World's Fair hackathon (submission by 2026-10-13). See [`GOVERNANCE.md`](./GOVERNANCE.md) for how decisions are made at this stage, [`docs/BUSINESS-PLAN.md`](./docs/BUSINESS-PLAN.md) for the phased business and development plan, [`docs/PRODUCT-FEASIBILITY.md`](./docs/PRODUCT-FEASIBILITY.md) for the effort/risk/impact study behind what gets built next, [`docs/VIDEO-SCRIPT.md`](./docs/VIDEO-SCRIPT.md) for the submission video script, [`docs/UI-SPEC.md`](./docs/UI-SPEC.md) for the portal/dashboard structure, [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) for how to host it, and [`TERMS-OF-USE.md`](./TERMS-OF-USE.md) for the service's terms (draft, pending legal review — see the notice at the top of that file). There's also an internal Contributor Agreement covering hackathon prize money and future equity intentions, shared privately with signed-in contributors only — not published in this public repo (see `docs/signatures/README.md` for the public, non-financial record of who signed).

## Try it live

A demo account is open for testers and developers at **https://viligion.com**. It watches a test wallet on the Tempo **Moderato testnet** (no real funds involved), so feel free to log in and explore the dashboard.

- **Username:** `henri`
- **Password:** `dSjmGANqxMSdAwzTsTUJ`
- **2FA (TOTP):** this account requires a 6-digit code from an authenticator app (Google Authenticator, Authy, 1Password...). Add it via "enter code manually" with:
  - Secret: `XSKAP6LIQMO3CRLYXP3GLT5DMOES52PS`
  - Type: time-based, 6 digits, 30s period

This is a shared demo account with synthetic/test data only — don't register real recipients or treat its content as private. See [`SECURITY.md`](./SECURITY.md) for why personal alert data never works this way in a real deployment.

## License

MIT — see [`LICENSE`](./LICENSE).
