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

A repository review found pieces described in the documentation (or already with logic/schema in place) that weren't connected end-to-end. Most have since been closed (see "Portal" below); what's left:

- **No production KMS key provider**: `LocalDevKeyProvider` (`privacy/encryption.ts`) is explicitly dev-only and is still what `index.ts` uses in both bootstrap paths — before processing real user data, swap it for a provider backed by `@aws-sdk/client-kms` or equivalent (see the warning `index.ts` logs at boot when `ENCRYPTION_KEY_KMS_ARN` is unset). Tracked as [issue #9](https://github.com/JefersonCruz/VILIGION/issues/9).
- **Per-user RPC overrides still come from shared env vars** — only alert recipients were migrated to per-user data (see "Recipients" below); a per-account RPC override is still a shared config, not user data.

~~No health check for the monitor itself~~ — closed 2026-10-08, see below.

## Monitor reliability: unpaginated `eth_getLogs` + no health check (closed 2026-10-08)

Reproduced in practice ([issue #8](https://github.com/JefersonCruz/VILIGION/issues/8), filed by a collaborator): running the server locally in demo mode threw `InvalidParamsRpcError: query exceeds max block range 100000`. Root cause: `EvmAdapter.getConfirmedLogs` (`engine/chains/evm-adapter.ts`) made a single `eth_getLogs` call for whatever range it was given — correct as long as every caller pre-clamped its range, which `monitor.ts`'s extension path did (since the 2026-10-07 production fix, `MAX_LOG_RANGE_BLOCKS = 50_000n`) but `TempoAdapter.getFeeAdjustment` did not: a long gap between ticks (RPC down, process stalled) could still hand it an unbounded range with zero protection.

Two fixes, matching the issue's two tasks:

- **Pagination moved to the root, not the caller**: `getConfirmedLogs` now loops internally in `MAX_LOG_RANGE_BLOCKS`-sized windows (the constant moved to `evm-adapter.ts`, exported, so `monitor.ts` imports it instead of duplicating the number) and concatenates results — any range, from any caller present or future, is now safe by construction, not by every caller remembering to clamp first. The actual RPC call is isolated in a new protected `rawGetLogs` so tests can verify chunk boundaries without mocking viem's client (`evm-adapter.test.ts`).
- **Health check**: `Monitor` now tracks consecutive tick failures and, every `UNHEALTHY_AFTER_CONSECUTIVE_FAILURES` (3) of them, calls an optional `onUnhealthy` listener — resets silently on the next successful tick, logs the recovery. `index.ts` wires a default listener, `buildUnhealthyNotifierIfConfigured`, that emails `OPS_ALERT_EMAIL` (new, optional env var) via the same SMTP config already used for customer alerts — but as a distinct operational message, never through `alert-content-policy`/`buildAlertEmail` (that pipeline is specifically for what a *customer* learns about their own treasury, not for the team's own ops signal). Without `OPS_ALERT_EMAIL`/SMTP configured, the failure still only reaches the local log — same honest degrade-without-lying pattern as the voice/email alert channels elsewhere in this file.

Covered by `evm-adapter.test.ts` (new file: single call within range, exact-boundary range, one-block-over paginates into two, a range reproducing the real ~43M-block bug paginates into several contiguous chunks with no gap/overlap, `toBlock < fromBlock` makes zero calls) and four new cases in `monitor.test.ts` (triggers at the exact threshold, not before; resets and can trigger again after recovering; a throwing listener doesn't take the monitor loop down with it).

## Portal (built 2026-10-03, see `docs/UI-SPEC.md`)

The signup/login/dashboard portal specified in `docs/UI-SPEC.md` is built and end-to-end tested (curl smoke test against a running server, including a real EIP-191-signed signup and a rejected forged signature) — not just typechecked:

- **Identity unified**: `privacy/signup-service.ts#SignupService` orchestrates ownership-proof verification → encrypted phone↔address persistence → `dashboard_users` row with the *same* UUID as `phone_mappings.id` → default thresholds, in one call. Depends on ports (`PhoneMappingStore`/`DashboardUserStore`/`ThresholdsStore`), not concrete Postgres classes, so the same service runs against either backend.
- **Dual backend, chosen by `DATABASE_URL`** (`index.ts`): with it set, `mainWithDatabase()` boots one `Monitor` per row of `monitored_accounts.listAll()` (any EVM-compatible chain, any token, any user) and wires the dashboard to real Postgres repositories; without it, `mainDemo()` keeps the original single-chain env-var-driven path with in-memory equivalents of every port (`dashboard/in-memory-repositories.ts`) — same code paths, same tests, zero external dependency to try locally.
- **Screens**: `/signup` (wallet-signature via raw EIP-1193 `window.ethereum`, no bundler, success page shows a scannable QR for the TOTP secret via `dashboard/otp-qr.ts`), `/login`, `/dashboard`, `/accounts` (add/remove any known chain + token), `/thresholds`, `/recipients` (alert destinations, see below), `/alerts` (severity/channel/PIN history) — server-rendered HTML (`dashboard/views.ts`), session via HttpOnly cookie (`dashboard/cookies.ts`). The original JSON API (`POST /login`, `GET /details`, Bearer token) is untouched for programmatic callers.

## Recipients (built 2026-10-03)

Alert destinations (phone numbers for the voice channel, emails for the normal channel) are now per-user data, closing the gap this document and `docs/UI-SPEC.md` used to list under "what's left":

- **`alert_recipients` table** (`privacy/mapping-schema.sql`), `user_id` → `phone_mappings.id` like every other per-user table, `kind` ∈ `phone | email`.
- **Port** (`RecipientsPort` in `dashboard/server.ts`): `listForUser`/`add`/`remove`, same shape as `MonitoredAccountsPort`. `db/postgres-repositories.ts#PostgresRecipientsRepository` and `dashboard/in-memory-repositories.ts#InMemoryRecipientsRepository` satisfy it, same dual-backend pattern as everything else.
- **`index.ts` dispatch reads recipients at alert time**, not from a shared array captured at boot — in `mainWithDatabase()`, `makeDispatcher(userId)` queries `PostgresRecipientsRepository.listForUser(userId)` per alert, so adding a recipient in the dashboard takes effect without restarting the process. `DEMO_ALERT_NUMBERS`/`DEMO_ALERT_EMAILS` still exist, but only to seed `mainDemo()`'s in-memory recipients once at boot (so the demo keeps working out of the box) — they have no effect at all when `DATABASE_URL` is set.
- **Fixed a latent id-mismatch bug found while wiring this**: `mainDemo()`'s fixed `thresholds.userId = "demo-user"` never matched the random `userId` that `InMemoryUserRepository.createDemoUser()` generated for the printed demo login — so `/thresholds` (and now `/recipients`) would 404/empty for whoever actually logged in with the printed demo credentials. `createDemoUser` now takes an optional `userId` param; `mainDemo()` passes `thresholds.userId` so the demo login's session id matches the id everything else (thresholds, recipients, dispatch) is keyed on.
- Validated end-to-end the same way as the rest of the portal: curl smoke test (real EIP-191 signup → TOTP login → add phone + email recipient → confirm both listed → delete one → confirm only the other remains), not just typecheck.

### Privacy audit (2026-10-03) and fix: recipients weren't encrypted, and the signup phone number was dead code

A same-day review found the first cut of `/recipients` stored `value` as plain `TEXT`, with `user_id` referencing `phone_mappings.id` — the same id `monitored_accounts.watched_address` is keyed on. A database leak would have JOINed those two tables for free, handing out exactly the "this phone/email gets alerted about this on-chain address" link that `SECURITY.md`'s first threat row (and the whole reason `phone_mappings` is encrypted) exists to prevent.

The review also found the signup-time `virtualPhoneNumber` — encrypted, signature-gated, the mechanism described in the README/this document as the product's core privacy design — was **never decrypted anywhere in the codebase**. It was captured, encrypted, and persisted, but no code path ever read it back to place a call or send an email; real alert delivery already went through the (then-plaintext) `/recipients` list. Two disconnected "phone number" concepts existed for the same job.

Fixed both in the same pass, not left as a documented gap, since the mismatch directly contradicted a security claim this project makes to judges:

- `alert_recipients` now stores `encrypted_data_key`/`iv`/`auth_tag`/`ciphertext` (same shape as `phone_mappings`), encrypted/decrypted through the same `MappingEncryption` instance already wired for signup, in both `PostgresRecipientsRepository` and `InMemoryRecipientsRepository` (same code path in demo and production, so a bug here would surface locally too). Trade-off accepted: dropping the per-value `UNIQUE` constraint, since ciphertext differs per call (fresh IV/DEK) even for the same plaintext — a user can add the same number twice; they see and remove the duplicate themselves in `/recipients`, no server-side dedup.
- `virtualPhoneNumber` removed from `/signup` entirely — the field, the form input, and `PhoneMappingService.register()`'s phone parameter. `phone_mappings` keeps its structural role (the identity anchor every other table's `user_id` references, created by proving control of the address via EIP-191), it just no longer pretends to also be the alert-delivery mechanism. Real alert destinations are registered after login, in `/recipients`, where they belong.

Full test suite and a repeated curl smoke test confirm the behavior is otherwise unchanged (same routes, same UX) — only the storage and the signup form surface changed.

## Fee vs. value-transfer classification (closed 2026-10-03)

`TempoAdapter.classifyBalanceDelta` used to be an unwired stub: it existed, but always returned `"value-transfer"` and `monitor.ts` never even called it before `checkBalanceDrop` — a routine fee deduction (Tempo has no native gas token, the fee comes out of the same monitored TIP-20) could trigger a false-positive "balance drop" if the observed address transacted mid-recording.

Replaced with `EvmAdapter.getFeeAdjustment(fromBlock, toBlock, address)`, following the same core-plus-adapter pattern as the rest of the engine:

- **Default on `EvmAdapter`: always `0n`** — correct for any EVM chain with a real native gas token (Base, Arbitrum, Ethereum L1), where the monitored token's balance is never touched by fees.
- **`TempoAdapter` override does the real work**, per [the official fee spec](https://tempo.xyz/developers/docs/protocol/fees/spec-fee) and [fee-AMM spec](https://tempo.xyz/developers/docs/protocol/fees/spec-fee-amm) (confirmed 2026-10-03): a fee payment is not its own event, it's an ordinary TIP-20 `Transfer` from the payer to the `FeeManager` precompile (`0xfeeC000000000000000000000000000000000000`, a fixed system address like `ReceivePolicyGuard`), with a possible `Transfer` back on post-execution refund. `getFeeAdjustment` scans `Transfer` logs of the monitored token between the two blocks and nets fees paid against refunds received.
- **`monitor.ts#tick()` adds that adjustment back onto the current balance** before calling `checkBalanceDrop` — a drop that's entirely fee nets to zero (no alert); a drop that's partly fee and partly a real outgoing transfer still triggers on the real portion only.
- Tests: `engine/chains/tempo.adapter.test.ts` (fee-only, fee-plus-refund, unrelated transfer, no-op same-block cases, against hand-built `Transfer` logs — no RPC) and two new cases in `monitor.test.ts` confirming the false positive is gone and a partial real drop still alerts.

## Redundant RPC calls per tick (fixed 2026-10-03)

Found while auditing for performance: with an extension (Tempo), `monitor.ts#tick()` called `adapter.getConfirmedBlockNumber()` to decide whether a new block needs checking, then handed the extension only `fromBlock` — never the confirmed block it had just fetched. `ChainExtension.checkExtra()` (and, underneath it, `TempoAdapter.getBlockedTransfers()` → `getConfirmedLogs()`) had no `toBlock`, so it called `getConfirmedBlockNumber()` a second time to get back the exact same answer a few milliseconds later. One extra round trip to the RPC per account per poll cycle (every 15s) for no reason — harmless at hackathon scale, but it's the kind of waste that pushes a public RPC endpoint toward its rate limit first as the number of monitored accounts grows.

Fix: `ChainExtension.checkExtra(fromBlock, toBlock, thresholds)` now takes the confirmed block as a parameter; `monitor.ts` passes the value it already has instead of letting the extension ask again. `TempoBlockedTransferExtension` and `TempoAdapter.getBlockedTransfers` thread it straight through. Covered by a new case in `tempo-extension.test.ts` (asserts the adapter receives the exact `fromBlock`/`toBlock` passed in) and one in `monitor.test.ts` (asserts the extension receives the exact confirmed block the Monitor computed, not a recomputed one).

## Dynamic monitor registration (fixed 2026-10-04)

A capacity/correctness audit found the most serious gap yet: `docs/DEPLOYMENT.md` already documented, correctly, that "the monitor only reads new accounts at boot" — `mainWithDatabase()` called `monitoredAccounts.listAll()` once and started one `Monitor` per row, and `dashboard/server.ts#handleAddAccount` only wrote the new row to `monitored_accounts`, with nothing starting a `Monitor` for it. In practice: a real user who signs up, logs in, and registers their treasury in `/accounts` was **never actually monitored** until someone manually redeployed the whole process. For a self-service product, that's not a scaling limit, it's the alerting pipeline not functioning for any new account at all.

Fixed by giving the dashboard a way to control monitors live, not just read/write `monitored_accounts`:

- **`startMonitorForAccount` now returns the `Monitor` instance**, not just a background promise — it used to build the `Monitor` inside an async IIFE and throw the reference away once `.start()` was called, which made it impossible to `.stop()` later. Thresholds are fetched once up front (same as before) and the function awaits that before constructing, instead of racing it inside the loop.
- **New port, `MonitorControlPort`** (`dashboard/server.ts`): `start(account)` / `stop(accountId)`. `handleAddAccount` calls `start()` right after the DB insert, with the full row (including the generated id); `handleDeleteAccount` calls `stop()` only when `remove()` actually deleted something — never stops a monitor because of a request for an account that didn't belong to the caller.
- **`mainWithDatabase()` keeps a `Map<accountId, Monitor>`** (`liveMonitors`) and implements the port against it: `start` builds+starts+registers a `Monitor`, `stop` calls `.stop()` on the registered instance and forgets it. Boot still calls `listAll()` once to seed existing accounts, now via the same `bootMonitor` function the live path uses — one code path for "existing account at boot" and "new account from the dashboard", not two.
- **`mainDemo()` gets an explicit no-op implementation**, not a silent gap: demo mode's `/accounts` list was never wired to a real monitor even before this fix (the only real monitor there is the fixed one from `DEMO_WATCHED_ADDRESS`), so the no-op just makes that pre-existing limitation visible in the code instead of leaving the port unimplemented.
- Validated with a new `dashboard/server.test.ts` — a real `http.Server` (via `createDashboardServer`) against fake ports (no Postgres needed to prove the wiring), covering: adding an account calls `monitorControl.start` with the right data; deleting one calls `stop`; a delete that doesn't actually remove anything (wrong owner) never calls `stop`. Couldn't repeat the manual curl smoke test against a real `mainWithDatabase()` this time — no Postgres available in this environment — so this automated test is the equivalent proof for this fix specifically, not a replacement for re-running the full manual smoke test before the next real deploy.

`docs/DEPLOYMENT.md` updated to match: step 7 no longer tells the operator to redeploy after adding an account.

## PIN confirmation was never actually deliverable (fixed 2026-10-04)

A security/alerts audit found that `alerts/twilio-voice.ts`'s spoken script told the call recipient to "press the 4-digit code sent via WhatsApp" — but no code anywhere sent that WhatsApp message. `TWILIO_WHATSAPP_NUMBER` existed in `.env.example` and was never read by anything. In practice, no real user receiving the call had any way to know the PIN to enter; the feature only appeared to work in the demo because `mainDemo()` prints the PIN to the server console, which only the person running the demo can see.

Fixed by actually wiring the channel the script always claimed to use, with a safe fallback instead of a silent gap:

- `createTwilioVoiceClient` now takes an optional `whatsappFromNumber` and `placeAlertCall` now takes the real `pin` (previously it didn't even receive it — `index.ts` generated the PIN and stored it in `pinStore`, but never passed it to the voice client at all).
- **If `whatsappFromNumber` is configured**: sends the PIN via Twilio's WhatsApp messaging API (same client, `messages.create`, `to`/`from` auto-prefixed with `whatsapp:`) to every recipient, in parallel with the call — exactly what the spoken prompt already promised.
- **If it isn't configured**: the spoken prompt no longer lies about a channel that doesn't exist — the TwiML speaks the PIN directly, digit by digit (`"1 2 3 4"`, not "one thousand two hundred thirty-four", for TTS clarity), so the feature degrades instead of silently failing.
- `createTwilioVoiceClient` also gained an injectable `TwilioLikeClient` parameter (same pattern as `email-notifier.ts`'s injectable `Transporter`) — this file had zero tests before (hard to test against the real Twilio SDK), now covered by `twilio-voice.test.ts`: calls every recipient; sends WhatsApp to every recipient with the right `to`/`from`/body when configured; never calls WhatsApp and speaks the PIN instead when not configured; never leaks balance/address in the spoken content either way.

Known limitation, already documented, still applies: the free Twilio WhatsApp sandbox number is shared/public — fine for testing, not for a real customer's PIN (see "Known limitations" above).

## Two small hardening fixes (2026-10-04)

Found in the same audit pass, both low-risk and now closed:

- **Session cookie missing `Secure`**: `dashboard/cookies.ts` set `HttpOnly; Path=/; SameSite=Lax` but never `Secure` — the cookie could in principle be sent over a plain HTTP connection, not just HTTPS. Added to both `buildSessionCookie` and `buildExpiredSessionCookie`. Covered by a new case in `cookies.test.ts`.
- **PIN had no attempt limit**: `alerts/pin.ts`'s `PendingPin` gained an `attempts` counter and a `MAX_ATTEMPTS = 3`; `checkPin` now returns `"locked"` once that's reached, even for the correct PIN — the webhook endpoint already requires a valid Twilio signature (so an outside attacker can't reach this at all without forging that first), but whoever *is* on the call could otherwise try all 10,000 four-digit combinations within the 5-minute TTL with nothing stopping them. `webhook-server.ts` increments `attempts` only on a genuine `"invalid"` result (not on `expired`/`already-consumed`/`locked`, so re-checking an already-locked PIN doesn't itself count as a new attempt). While touching the comparison, swapped the plain `!==` for `timingSafeEqual` (same reasoning as `dashboard/password.ts`) — free, closes the residual timing side-channel. Covered by two new cases in `pin.test.ts` (locks after 3 wrong tries, even the real PIN stops working after that; mismatched-length input never throws).

## Recipient format validation (closed 2026-10-04)

`/recipients` accepted any string as a phone number or email — a typo was only discoverable when Twilio or SMTP rejected it at the moment a real alert needed to fire, the worst possible time to find out. New `dashboard/recipient-validation.ts` (pure, no dependencies): `isValidPhone` checks E.164 shape (`+`, non-zero leading digit, 8–15 digits total — what Twilio's voice/WhatsApp APIs require), `isValidEmail` is a deliberately pragmatic check (has `@`, has a domain with a dot), not a full RFC 5322 validator, since the real validation that matters happens at send time anyway. `handleAddRecipient` in `dashboard/server.ts` rejects an invalid value with a clear message instead of persisting it. 13 new tests in `recipient-validation.test.ts`.

## Editable thresholds (rolling window, live reload, USD UI)

Full design in `docs/THRESHOLDS.md`. Summary of what changed in the code:

- **Live reload**: `Monitor` takes a `ThresholdsSource` (value or async function) resolved on every tick (15 s); on a read error it keeps the last good value. `index.ts` passes a function reading `thresholdsRepo.get(userId)`, so edits apply without restarting.
- **Rolling window**: `rules/balance-window.ts#BalanceWindow` compares the current (fee-adjusted, cumulative) balance against the maximum seen within `windowMinutes` (up to 1440), so a slow drain split into small transfers is caught. Anti-repeat: it re-alerts only on severity escalation or when the drop grows by `maxBalanceDropPct` points; `forgetLastAlert()` re-arms it if dispatch fails.
- **Validation**: `rules/threshold-validation.ts#validateThresholds` is the single source of truth (0.1 ≤ warn < crit ≤ 100, window 1–1440 min, blocked warn < crit); the server rejects incoherent sets with HTTP 400 and re-renders the form with what the user typed.
- **USD instead of raw units**: `rules/token-units.ts` converts "2000", "20,5" ⇄ token base units with `bigint` only (6 decimals assumed).
- **UI**: `rules/threshold-presets.ts` (Conservador/Equilibrado/Tolerante) and `dashboard/thresholds-ui.ts` (scoped CSS + client script) render a live preview using the user's real balance and a "simulate an outflow" slider. The preview only exists inside the authenticated dashboard; alerts themselves never carry balance or address.
- z-score is intentionally not used for critical alerts (see roadmap in `docs/THRESHOLDS.md`).
