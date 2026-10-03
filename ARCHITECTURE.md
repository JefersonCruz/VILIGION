# Architecture

## Design principle

**Generic core + per-chain adapter**, not a "universal" engine. Balance/pattern detection logic is shareable across EVM chains (Tempo, Base, Arbitrum, Ethereum L1), but protocol-specific rules — like decoding Tempo's `ReceivePolicyGuard` (TIP-403) events — **don't exist** on other chains and live isolated in the adapter.

## Modules

### 1. `/engine` — Detection engine
- `chains/evm-adapter.ts` — balance/event reads via RPC (Viem), generic across EVM chains.
- `chains/tempo.adapter.ts` — Tempo-specific: decodes `ReceivePolicyGuard` contract events; handles the fact that Tempo has no native gas token (fees come out of the TIP-20 itself, which requires distinguishing a fee deduction from a real outbound transfer of value).
- `rules/detection-rules.ts` — **open** rule logic (e.g. "percentage drop", "transfer redirected to the Guard"). Each user's exact numeric thresholds stay out of this file, in private per-user configuration.

Source of truth: direct RPC via Viem, not Tempo's Indexer API (which the official docs themselves describe as "still evolving"). The Indexer is only used for secondary dashboard features (history, analytics), never on the alert's critical path.

Reorg protection: an alert only fires after a minimum confirmation depth.

### 2. `/privacy` — Privacy layer
- `encryption.ts` — encryption method for the phone↔address link (AES), publicly documented; the **key** lives in managed KMS (never in the same environment as the database).
- `ownership-proof.ts` — requires a signature (`signMessage`/`recoverAddress` via Viem) at signup, proving whoever registers the phone number actually controls the address.
- `alert-content-policy.ts` — hard rule: no monetary value or address ever goes out in voice/SMS alert content, under any circumstance.

### 3. `/alerts` — Delivery layer
Two channels, chosen by **severity** (`DetectionEvent.severity`, decided in `detection-rules.ts` from a second, per-event-type "critical" threshold) — not every anomaly justifies the cost and exposure of a phone call:

- `twilio-voice.ts` — **critical** severity: real phone call via Twilio Programmable Voice.
  - `twilio-webhook-validator.ts` — validates the `X-Twilio-Signature` header on every endpoint that receives a callback — without this, anyone who discovers the webhook URL could forge a PIN confirmation.
  - The PIN is **single-use**, tied to a specific alert ID, never reusable.
  - Multiple configurable recipients (mitigates both alert fatigue/TDoS and the scenario where a single recipient is themselves the target of coercion).
- `email-notifier.ts` — **normal** severity: email via generic SMTP. No per-message cost, no carrier CDR retention problem (see `SECURITY.md`). Reuses the same content policy (`alert-content-policy.ts`) — the "never reveals balance/address" guarantee applies equally to both channels.
- Both clients are **optional** at runtime (`index.ts`): without Twilio/SMTP configured, the corresponding alert just logs to the console instead of crashing the app — lets you run the monitor and validate detection before you have a Twilio account.
- `locale.ts` — alert content language, English or Portuguese, not a full i18n system (no per-user selection, no locale files). Resolved from `ALERT_LOCALE` (default `en`, chosen for the hackathon demo video's international audience); a real Brazilian customer switches it to `pt` via config, no code change needed. Covers the TwiML `<Say>` language attribute, the call/email message text, and the email subject/footer — all three pull from the same two-entry map.

### 4. `/dashboard` — Dashboard
- Login with MFA + rate limiting (protection parity with the voice layer — no point protecting the phone call and leaving the dashboard with simple login).
- The only place where the full balance/address is shown.

## What's public vs. private in the repository

| Public (in this repo) | Private (never in the repo) |
|---|---|
| Detection and rules logic | Per-user configured numeric thresholds |
| Encryption method (how it works) | The encryption key itself |
| Database schema | Real user data |
| Twilio integration (code) | Twilio credentials/API keys |
| TIP-403/ReceivePolicyGuard event decoder | — |

## Roadmap: PWA push channel (post-hackathon)

We evaluated replacing the phone call with an installable app (PWA) using background push notifications, motivated by reducing dependency on Twilio. Decision: **don't replace it, only complement it later**.

Why:
- The product's validated differentiator (see README.md and the market research behind the pitch) is precisely **not requiring any installed app** — that's what sets it apart from Hexagate/Elliptic/TRM, which assume a technical user engaged with their own tool. A PWA app reintroduces exactly that barrier for the audience the product tries to serve.
- A phone call has a higher effective interruption rate than a push notification (rings/vibrates vs. piles up in a badge most people ignore) — for an urgent security alert, that matters.
- The sensitive-data leak that motivated the idea **is already mitigated** by the generic content policy (`alert-content-policy.ts`) — Twilio never sees balance/address, only "call with a generic phrase." Switching channels doesn't fix a problem already solved at the content layer.
- Push also depends on a third party (APNs/FCM) — it doesn't eliminate external dependency, it just swaps which company sees delivery metadata.

If implemented in the future, as an **additional redundant channel** (reinforcing the TDoS mitigation already designed, multiple simultaneous channels) and not as a replacement:
- PWA with the Web Push API, not a native app — an app store (App Store/Play Store) isn't viable for a hackathon timeline, nor for keeping fast-deploy parity afterward.
- Real technical caveat: PWA push on iOS only works from iOS 16.4+, and requires the user to have manually done "Add to Home Screen" beforehand — adoption of that step tends to be low, so it shouldn't become the primary channel even in the future.

### Sub-idea evaluated: distinct sound and vibration per alert type (MSN-style "nudge")

We evaluated (2026-10-03) giving the user a characteristic sound/vibration per event type (`kind` × `severity`), to recognize what happened without even looking at the screen. Worth implementing, but only as part of the dashboard **open and in focus**, not as a background system notification — two real platform limitations:

- `navigator.vibrate()` doesn't exist on iOS Safari (Apple never implemented it) — works only on Android.
- Custom sound per category **isn't supported by any browser** for system push notifications (Chrome/Firefox/Safari always use the OS default sound) — it only works as plain JS playing audio, which requires the tab already open and in focus.

Prerequisite that doesn't exist yet: `dashboard/server.ts` today is just a JSON API (`/login`, `/details`) — there's no HTML page nor a real-time push channel (SSE/WebSocket) from `dispatchAlert` to the browser. Implementing the nudge requires building those two pieces first, not just adding sound files. Real scope: an SSE endpoint streaming events + a minimal dashboard page subscribing to that channel + 2-4 distinct sounds (critical vs. normal, optionally by `kind` too).

Decision: treat as a post-hackathon roadmap item alongside PWA push, not build before the submission deadline — priority right now is validating against the real network, recording the videos, and completing the submission.

## Known limitations (documented for honesty, not hidden)

- Thresholds calibrated on testnet (Moderato) don't necessarily generalize to mainnet — balance behavior on testnet is noisier (faucets, test scripts).
- Dependency on Twilio and Tempo RPC availability.
- The WhatsApp sandbox (if used in a demo) is a publicly known, shared Twilio number — valid for demonstration only, not production.

## Architecture gaps (audited 2026-10-03, none hidden)

A repository review found pieces described in the documentation (or already with logic/schema in place) that aren't connected end-to-end yet:

- **Postgres persistence built, not yet wired into `index.ts`/`dashboard/server.ts`** (updated 2026-10-03): `db/postgres-repositories.ts` has `PostgresPhoneMappingRepository`, `PostgresMonitoredAccountRepository`, and `PostgresAlertLog`, tested (injectable `Queryable`, no real Postgres needed for the test), with `scripts/migrate.ts` applying `privacy/mapping-schema.sql` idempotently. What's missing: `index.ts` still bootstraps only the single demo monitor (fixed env var), it doesn't read `monitored_accounts` from the database; `dashboard/server.ts` still uses the in-memory implementations (`InMemoryUserRepository`, etc.) for login — unifying the dashboard login identity with `phone_mappings.id` is a design decision not yet made, not just missing code.
- **Signup (`PhoneMappingService.register`) exists but isn't exposed over HTTP**: the ownership-proof + encryption logic is complete and tested (`privacy/phone-mapping.ts`, `privacy/ownership-proof.ts`), and now has somewhere to persist to (`PostgresPhoneMappingRepository.save`), but no route in `dashboard/server.ts` calls it — today there's no way for a real user to sign up through the system.
- **`monitored_accounts` (table and repository exist) still has no endpoint to choose a chain/token**: the table already supports any known EVM-compatible chain (`known-chains.ts`) and any ERC-20/TIP-20 token per user, but the HTTP route that validates the choice (`getKnownChain`) and writes it via `PostgresMonitoredAccountRepository.add` is still missing.
- **`TempoAdapter.classifyBalanceDelta` is an unwired stub**: it exists, but (a) always returns `"value-transfer"` (never filters out a fee), and (b) `monitor.ts` doesn't even call this function before `checkBalanceDrop` — meaning today a routine fee deduction (remember: Tempo has no native gas token, the fee comes out of the same monitored TIP-20) can trigger a false-positive "balance drop". Real risk of noise during a demo if the observed address transacts mid-recording.
- **No health check for the monitor itself**: if the loop in `monitor.ts` stops progressing (RPC down, unhandled error), today it only shows up in the local log — nothing actively alerts the team. The previous line of this document claimed this existed; it doesn't, corrected here.
