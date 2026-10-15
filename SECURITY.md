# Threat Model and Security Policy

## Why this document exists

This project handles data that, if leaked or poorly designed, can expose users to financial **and physical** risk (coercion attacks tied to crypto ownership — "wrench attacks"). We treat this as a design requirement, not a checklist item.

## Threat model

| Threat | Mitigation |
|---|---|
| Database leak exposes which phone/email alerts about which on-chain address (`alert_recipients` joined with `monitored_accounts` by `user_id`) | Recipient value stored encrypted (AES-256-GCM, envelope encryption) — same scheme as the signup identity record (`phone_mappings`). **Partial today**: the data-encryption keys are wrapped by `LocalDevKeyProvider` (key from an environment variable in the same deployment as the app), *not* by a managed KMS. A leak of the database alone still yields ciphertext, but an attacker who also reads the app's environment gets the key. Closing this (managed KMS, key outside the app environment) is required before any real customer data — tracked in [issue #9](https://github.com/JefersonCruz/VILIGION/issues/9) and `ARCHITECTURE.md` → "Architecture gaps" |
| SIM swap / phone line interception | Alert content never reveals balance/address; a sensitive action is never authorized by voice/SMS PIN alone |
| Someone claims another person's public address as their own at signup | Signature required (`signMessage`) proving control of the address at signup — identity (`phone_mappings`) is separate from alert recipients, registered later from an already-authenticated session (password + TOTP) |
| Forging PIN confirmation via webhook | Mandatory `X-Twilio-Signature` header validation on every endpoint that receives a callback |
| TDoS (flooding the alert line during a real attack) | Multiple configurable channels and recipients; no dependency on a single line |
| Compromised Twilio account (vishing, smishing — has happened to Twilio itself in 2022 and 2024) | Minimal account permission scope, API key rotation, PIN always single-use and tied to a specific alert |
| Carrier call-detail-record (CDR) retention exposes that a number is a VILIGION customer — even without account compromise. Confirmed: Twilio retains From/To for 13 months (Console/API) and indefinitely via Bulk Export; in Brazil, ANATEL (Resolution 426/05) requires a minimum 5-year retention by any carrier, regardless of provider — **this isn't Twilio-specific, it's regulatory** | Doesn't reveal balance/address (only that the relationship exists). Mitigated by scope: the phone call is reserved for **critical** severity (see `detection-rules.ts`/`ARCHITECTURE.md`) — reduces call volume, doesn't eliminate the residual exposure. Accepted as a documented limitation, same "obscured, not secret" pattern used for detection thresholds |
| Physical coercion attack on the owner ("wrench attack") | Multiple possible recipients; no value information exposed on the voice channel, reducing the incentive to force the owner to answer |
| Web dashboard as an easier target than the voice channel | MFA + rate limiting on login, protection parity with the voice layer |

## What we never do

- We never hold the user's private key.
- We never execute a transaction from a voice/SMS reply.
- We never reveal balance or address in an alert's content.
- We never store credentials in plaintext in the repository or in the same environment as the data they protect.

## The push channel, and what it does and does not solve

Added 2026-10-11. The CDR row above describes the one exposure in the alert path we cannot engineer away while the channel is a phone call: a phone number is attributable to a person, and its retention is regulatory, not a vendor setting. Encrypting our copy harder does not help — the record isn't ours.

So the mitigation is to make the data unnecessary. Web Push (`src/alerts/web-push.ts`) delivers the critical alert to a device through an opaque endpoint the browser issues and the owner can revoke. There is no phone number to subpoena, no carrier record, and nothing in our database that links a person to an account through a number. **The property comes from the data not existing.**

What it does **not** solve, stated plainly:

- **It is not immunity from legal process, and we do not claim that.** We operate the service and hold the keys; what shrinks is the set of data we have to produce, not anyone's authority to ask. The defensible claim is data minimization — standard privacy-by-design, which LGPD/GDPR reward — not that a court order fails.
- **The push endpoint is itself a capability**, not a harmless identifier: whoever holds it can notify the device. It is therefore stored with the **same** AES-256-GCM envelope encryption as phone numbers, in the same table, and is never rendered in full in the UI or written to logs (only the push service hostname is displayed).
- **Reliability is strictly worse than a phone call.** It requires notification permission, and on iOS the app must be added to the home screen first. The most private channel is the least guaranteed one; both channels coexist and the owner is told this on `/recipients` rather than having it chosen for them.
- **Exercised on a real device in production on 2026-10-12**: a test alert was delivered and the notification arrived on a phone. The RFC 8291 encryption and VAPID signing are additionally covered by an integration test against a local push service.
- **The notification cannot carry its own sound.** The Notification API has no custom-sound property, so a critical alert plays the device's default notification sound — the same one as a chat message — and Do Not Disturb silences it. A phone call can be configured to break through. This is why the two channels coexist: push is the private channel, the call is the reliable one.
- The encryption key still comes from `LocalDevKeyProvider`, not a managed KMS ([issue #9](https://github.com/JefersonCruz/VILIGION/issues/9)) — this applies to push subscriptions exactly as it applies to phone numbers, and remains required before any real customer data.

## Community-contributed chain adapters (added 2026-10-12)

The project wants external contributors to add network support (see [`docs/ADAPTER_SPEC.md`](./docs/ADAPTER_SPEC.md)). That means third-party code in the same process as the alert pipeline and the encrypted recipient data, which is a threat worth stating rather than assuming away.

The boundary, and how each half is enforced:

- **Adapters are read-only.** No private key, mnemonic, signer or wallet; no `sendTransaction`/`signMessage`/`signTypedData`/`writeContract`. The conformance suite (`adapter-conformance.ts`) checks this structurally, on the adapter's whole prototype chain.
- **Adapters receive an address and nothing else.** Not a phone number, not an email, not a user ID, not a threshold value. There is no reason for an adapter to import from `privacy/`, `alerts/` or `dashboard/`, and a PR that does gets rejected on that basis alone.
- **Chain data is data, never command.** Normalized observations carry the original event in `details` for audit, and nothing in `details` may decide severity, select a delivery channel, become alert message text, or be interpolated into a log or HTML without escaping. The reason is direct: an event payload comes from whoever can emit an event, which includes whoever is attacking the monitored treasury. Only the detection rules, reading normalized numeric fields against the user's own thresholds, decide an alert.
- **An adapter that cannot read must say so, not guess.** Returning `0n` for a balance it cannot actually read makes the core treat "did not observe" as "nothing moved" — the user's dashboard says protected, and they are not. Capabilities are declared (`ChainCapabilities`), network failures propagate, and the conformance suite requires a deliberately failing adapter fixture to prove it.

**Honest limit of these controls:** the structural checks catch the good-faith mistake — someone parking a signer on an adapter because they expect to need it later. They do not stop a deliberately malicious adapter, which can hide from a name-based check. For that, the control is **mandatory human review of every adapter before merge**, plus the requirement that an adapter's tests run offline with no credentials so a reviewer can actually run them. A new runtime dependency introduced by an adapter is new attack surface in the alert path and is reviewed as such.

## Evaluation access for judges (added 2026-10-15, expires 2026-11-14)

A hackathon reviewer cannot reasonably be asked to set up an authenticator app before seeing anything, and an automated agent evaluating the product has the same problem. So there is a **single-factor, read-only** way in — and the trade is scope, not strength.

What the judge session **cannot** do: anything that changes state. The check is one decision point on the HTTP **method** — only `GET` passes — rather than a list of protected routes, because a list protects what was in it the day it was written, while "GET only" also protects routes nobody has written yet. Registering an account, editing thresholds, **changing an alert recipient** and firing a test alert all remain `POST`, and all still require the full login with password **and** TOTP.

That last point is the reason the design is shaped this way. This document and the project's submission both state that changing where an alert goes requires two factors. A single-factor shortcut that could *write* would have made that statement false. A read-only one does not.

Four limits, because "temporary" without a mechanism is permanent:

- **Off by default.** Without `JUDGE_ACCESS_PASSWORD` and `JUDGE_ACCESS_USERNAME` in the environment, the code path does not exist — including in any clone someone runs.
- **Dies on its own** at `JUDGE_ACCESS_EXPIRES_AT`, a fixed date in the source rather than an environment variable, so the deadline is auditable by anyone reading the repository. Reopening it requires a commit.
- **Rate limited.** The login limiter (5 attempts / 15 min) still applies, and it is the only barrier on a path with no second factor — which is also why a password under 12 characters is refused outright.
- **Logged.** Every judge login and every refused write is recorded.

**Honest limit:** this is still a password that grants read access to a dashboard showing a real monitored address and real alert history. It is not a safe pattern for a production account holding customer data, and it is not presented as one. It exists for a demonstration account on a testnet, with an expiry date attached.

## Known limitations

Detection thresholds are "obscured, not secret" — a patient attacker could empirically probe the limits with test transfers. This is an accepted, documented limitation, not a guarantee that evasion is impossible.

## Responsible disclosure

Found a security flaw? Report it privately through [GitHub Security Advisories](https://github.com/JefersonCruz/VILIGION/security/advisories/new). Don't open a public issue for an unpatched vulnerability.

There is deliberately no contact email: the `viligion.com` domain has no MX record, so an address on it would bounce, and publishing a founder's personal address on a product about not linking identities to treasuries would be the wrong trade. A role address replaces this once domain email exists.
