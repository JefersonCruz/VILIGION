# Terms of Use

> ⚠️ **Draft, not legal advice.** This is a starting point written to match what the product actually does and what `SECURITY.md` already commits to — it is **not** a substitute for review by a lawyer licensed where the service will actually operate, especially for the liability, data-protection, and dispute-resolution sections. Do not present this to a real paying customer before that review. Bracketed items (`[...]`) mark decisions that need a real answer (legal entity, jurisdiction, pricing) before this is final — see `docs/BUSINESS-PLAN.md` §3 on company formalization.

Last updated: 2026-10-03 (draft).

## 1. What this agreement covers

These Terms of Use ("Terms") govern access to and use of VILIGION (the "Service"), an on-chain treasury monitoring and alerting product described in [`README.md`](./README.md). By creating an account or using the Service, you agree to these Terms. If you don't agree, don't use the Service.

VILIGION's source code is separately licensed under MIT (see [`LICENSE`](./LICENSE)) — that license governs the *code*; these Terms govern use of the *hosted Service* (the dashboard, monitoring, and alerting you sign up for).

## 2. What the Service does — and does not do

The Service monitors a blockchain address you register, detects configured anomalies, and alerts you by phone call or email. Full behavior is described in `README.md` and `ARCHITECTURE.md`.

By design, and this will never change without updating these Terms first:

- **We never hold your private key.** You prove control of an address by signing a message with your own wallet; we never ask for, and never could use, your private key.
- **We never execute a transaction from a voice or SMS reply.** Any action that moves funds requires logging into the dashboard and signing with your own wallet.
- **Alert content never reveals balance or address**, on any channel — see `SECURITY.md` for why.
- **This is not a custody product and not a substitute for institutional security tooling** (Hexagate, Elliptic, TRM Labs, Blockaid). It's a complement aimed at owners without a dedicated security team.

## 3. No guarantee of detection or delivery — read this before relying on it for anything time-sensitive

This is the single most important section of these Terms, because the Service exists to warn you about something that can cost you money if you don't find out in time.

- Detection depends on third-party infrastructure we don't control: blockchain RPC endpoints, the Tempo network itself, Twilio (voice calls), and your email provider. Any of these can be slow, unavailable, or wrong.
- Thresholds are the ones you configured. An anomaly that doesn't cross your threshold will not alert you — that's a setting, not a defect.
- A confirmation-depth delay is applied before alerting (to avoid false alarms from chain reorganizations), which means there is always some lag between an event happening on-chain and you being notified.
- **The Service is provided on an "as is" and "as available" basis.** We do not guarantee that every anomaly will be detected, that every alert will be delivered, or that it will be delivered within any particular time. Use it as one layer of protection, not your only one.

## 4. Your account and responsibilities

- You must prove control of any address you register (wallet signature) — registering an address you don't control, to receive alerts about someone else's funds, is a violation of these Terms and may be unlawful.
- You're responsible for keeping your password and TOTP (two-factor) device secure. We cannot recover a lost TOTP device for you today — see the known limitation in [`ARCHITECTURE.md`](./ARCHITECTURE.md).
- You're responsible for the accuracy of alert recipients (phone numbers, emails) you register in `/recipients`. We're not responsible for an alert that reaches the wrong person because you entered the wrong contact.
- You must be legally able to receive automated phone calls and emails at the numbers/addresses you register, and must have the right to register them.

## 5. Fees

`[Placeholder — pricing has not shipped yet.]` The monetization model is documented in `docs/BUSINESS-PLAN.md` §1.3 (per-address SaaS, freemium with a paid voice-alert tier, and an on-chain TIP-20 billing option as a later differentiator). Until a paid plan is introduced, the Service is provided free of charge and this section will be replaced with real pricing terms before any charge is introduced — you will be notified before that happens, not charged retroactively.

## 6. Data and privacy

What we collect and how it's protected is described in detail in [`SECURITY.md`](./SECURITY.md) — read it, it's short and specific. In summary: proof of address ownership via signature at signup; alert destinations (phone/email) encrypted with envelope encryption, key held in a KMS separate from the database; alert content never includes balance or address; we never store credentials in plaintext.

`[Placeholder — a standalone Privacy Policy, covering retention periods, your rights to access/delete your data, and any specific requirement under the law of where you operate (e.g. LGPD in Brazil, GDPR in the EU), should exist before onboarding real users outside a closed beta. SECURITY.md documents the mechanism; it doesn't yet state retention periods or a deletion process in the language a data-protection regulation expects.]`

## 7. Service changes, suspension, and termination

- You can stop using the Service and ask for your account and data to be deleted at any time. `[Placeholder — a self-service delete flow doesn't exist yet; until it does, this happens on request.]`
- We may suspend or terminate an account that violates these Terms (for example, registering an address you don't control, or abusing the alert system in a way that looks like denial-of-service against the voice channel).
- We may change or discontinue features. We'll update these Terms when a change meaningfully affects what you're agreeing to.

## 8. Limitation of liability

`[Placeholder — needs real legal review for the jurisdiction(s) the Service will operate in before this is enforceable. The intent to preserve: the Service is a monitoring aid, not a guarantee against loss; our liability for any claim related to the Service, including a missed or delayed alert, should be capped at a defined, low amount (e.g. fees paid in the preceding period, which is $0 during the free phase) and should exclude indirect, consequential, or lost-profit damages, to the maximum extent the applicable law allows. Some jurisdictions don't allow excluding certain liabilities (e.g. gross negligence, willful misconduct, or statutory consumer-protection rights) — a lawyer needs to confirm what actually holds up where you operate before this section is relied on.]`

## 9. Governing law and disputes

`[Placeholder — depends on where the operating entity is formed; BUSINESS-PLAN.md §3 notes Stablecorp's incorporation support as the realistic next step, not yet done. Fill in once that's decided.]`

## 10. Changes to these Terms

We may update these Terms as the Service evolves. Material changes will be flagged before they take effect for existing accounts, not applied silently.

## 11. Contact

`[Placeholder — same contact gap already flagged in SECURITY.md's responsible-disclosure section; resolve both at once.]`
