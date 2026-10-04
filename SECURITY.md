# Threat Model and Security Policy

## Why this document exists

This project handles data that, if leaked or poorly designed, can expose users to financial **and physical** risk (coercion attacks tied to crypto ownership — "wrench attacks"). We treat this as a design requirement, not a checklist item.

## Threat model

| Threat | Mitigation |
|---|---|
| Database leak exposes which phone/email alerts about which on-chain address (`alert_recipients` joined with `monitored_accounts` by `user_id`) | Recipient value stored encrypted (AES, envelope encryption); key in managed KMS, never in the same environment as the database — same scheme as the signup identity record (`phone_mappings`) |
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

## Known limitations

Detection thresholds are "obscured, not secret" — a patient attacker could empirically probe the limits with test transfers. This is an accepted, documented limitation, not a guarantee that evasion is impossible.

## Responsible disclosure

Found a security flaw? Open a private issue (GitHub Security Advisory) or contact [email to be defined]. Don't open a public issue for unpatched vulnerabilities.
