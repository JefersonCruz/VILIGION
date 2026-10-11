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
- **Not yet exercised against a real device in production.** The RFC 8291 encryption and VAPID signing are verified by integration test against a local push service, not by a delivered notification on a real handset.
- The encryption key still comes from `LocalDevKeyProvider`, not a managed KMS ([issue #9](https://github.com/JefersonCruz/VILIGION/issues/9)) — this applies to push subscriptions exactly as it applies to phone numbers, and remains required before any real customer data.

## Known limitations

Detection thresholds are "obscured, not secret" — a patient attacker could empirically probe the limits with test transfers. This is an accepted, documented limitation, not a guarantee that evasion is impossible.

## Responsible disclosure

Found a security flaw? Open a private issue (GitHub Security Advisory) or contact [email to be defined]. Don't open a public issue for unpatched vulnerabilities.
