# Closing issue #9 — options for getting the key out of the app's environment

**Status: open design question. Nothing here is implemented.**

Written 2026-10-23, after the 2026-10-22 platform breach turned issue #9 from "required before real customer data" into blocking. `SECURITY.md` records the incident.

---

## What is actually wrong today

`LocalDevKeyProvider` reads the master key from `ENCRYPTION_KEY_KMS_ARN`, an environment variable in the same deployment as the application and the same deployment that holds `DATABASE_URL`. An attacker who reads that environment gets both the ciphertext's location and the key that opens it.

That is not a hypothetical. It is what the provider said may have happened.

The name of the variable is also a small lie worth fixing while we are here: it says `KMS_ARN` and holds a raw hex key. Nobody is fooled for long, but a variable that misdescribes itself is the kind of thing that makes a reviewer doubt everything next to it.

---

## The constraint that makes this non-trivial

**Recipients are decrypted on the alert path.** `AlertRecipientsRepository.listForUser` calls `encryption.decrypt(...)` (`db/postgres-repositories.ts`), and the alert dispatcher calls it every time an alert fires (`index.ts`). Each decrypt unwraps that record's data key through the `KeyProvider`.

So if the `KeyProvider` becomes a remote KMS, **every alert makes a network call to a third party before it can reach the owner.** If that service is slow or down, the alert is slow or does not go out.

This project already rejected exactly that shape of dependency elsewhere. From `ARCHITECTURE.md`:

> *"Source of truth: direct RPC via Viem, not Tempo's Indexer API ... The Indexer is only used for secondary dashboard features, never on the alert's critical path."*

Adopting a remote KMS naively would put back, in the most sensitive path, the dependency the architecture is proud of avoiding. Any option below has to answer this.

---

## Option A — Managed KMS, called on every decrypt

AWS KMS or GCP KMS as a real `KeyProvider`. The master key never exists in our process.

**For:** The strongest version of the property. An environment leak yields nothing: the attacker gets an ARN, not a key. This is what the documentation has been promising.

**Against:** Puts a third-party network call in the alert path, as above. Adds a cloud account, credentials to manage (which themselves live in... the environment), per-call cost, and a new failure mode where the treasury alert fails because a KMS endpoint is unhealthy.

**The credential irony:** KMS access needs credentials, and on this platform those live in the same environment that just leaked. It is better — a leaked KMS credential can be revoked centrally and its use is logged, which a raw key cannot be — but it is not the clean win it sounds like.

## Option B — Managed KMS, with the unwrapped key cached in memory

As A, but the unwrapped data keys (or a single key-encryption key) are cached in process memory with a TTL, so the alert path hits the cache.

**For:** Keeps KMS out of the hot path in the normal case. An environment leak still yields nothing.

**Against:** Plaintext key material lives in process memory for the cache's lifetime. That is strictly better than living in the environment — a leak of env vars does not expose process memory, and this breach was of the environment — but it is a real weakening of the claim, and the claim should then say "cached in memory for N minutes" rather than "never in our process".

Also: on a cold start with KMS unreachable, nothing decrypts. Needs a decision about whether the monitor refuses to start or starts degraded.

## Option C — Do not call the key service on the alert path

**Revised 2026-10-22, after reading the code this option was guessing about.** The first version of this option proposed resolving recipients once and holding them in memory. That was the wrong shape, and open question 3 below is now answered.

What the reading found: the alert path does need the recipient's actual phone number, so it cannot work from a handle. But the call that would become *remote* under a KMS is narrow — only `decryptDataKey` (`src/privacy/encryption.ts`). The database read and the content decryption stay local either way. So the KMS can be taken off the hot path by caching only the unwrapping of the per-record data key.

**Why not cache the recipients.** If invalidation ever fails, an alert goes to a number the owner *just removed*. In a product whose point is not leaking the link between a person and a treasury, alerting a removed destination is the one error that must not happen. Caching only the data key avoids it structurally: the database is still read on every alert, so removals and additions take effect immediately. What gets reused is only the key that opens a record — and if the record is gone, nobody asks for its key.

**For:** Makes A viable without its main cost. No invalidation problem, because nothing derived from the database is held. Smaller change than the original C: a decorator around `KeyProvider`, nothing else moves.

**Against:** Plaintext data keys live in process memory while cached — the same exposure as B, which is better than today (the *master* key in an environment variable is what leaked on 22/10) but weaker than "the key never exists in our process". The documentation has to say "cached in memory for N minutes".

**Status: implemented as groundwork, not wired in — in a separate change, not in this one.** `src/privacy/caching-key-provider.ts` (which depends on `encryptDataKey`, so it stacks on the key-rotation change) is a `KeyProvider` decorator that memoises `decryptDataKey` with a TTL and an entry cap, and deliberately **never caches failure** — memoising the error would turn a few seconds of KMS unavailability into a fixed failure for the whole TTL, on the alert path. Nothing uses it yet, and **the benefit today is approximately zero**: the local provider unwraps with in-memory AES, which is already cheap. Its purpose is that adopting a KMS later becomes a provider swap instead of a redesign of the alert path.

## Option D — Keep the key out of the platform, but not in a cloud KMS

Inject the key at deploy time from somewhere the platform does not store — an operator-held secret, or a secrets manager with short-lived leases — so the platform's environment store never holds the long-lived value.

**For:** Addresses exactly what broke, without a network call on the alert path.

**Against:** Operationally heavy for a one-person project, and it needs a restart to rotate. Honestly, it trades a clear risk for a process that is easy to get wrong when tired.

---

## What I would want before choosing

1. **Is there going to be a cloud account?** A, B and C all assume one. If the answer is no, the real choice is between D and accepting the risk with it written down.
2. **What is the acceptable failure mode when the key service is unreachable?** "Alert fails" is not acceptable for this product. "Alert goes out using a cached key" is probably fine. That answer picks between A and B/C on its own.
3. ~~**Does the alert path need the recipient, or just a handle?**~~ **Answered 2026-10-22: it needs the recipient.** The dispatcher cannot work from something resolved earlier. But that turned out not to matter, because the only call that goes remote under a KMS is the data-key unwrap, which can be cached without caching anything derived from the database. See the revised Option C.

## Recommendation

**C, then A** — remove the *key service* from the alert path first, which is useful on its own merits and does not require choosing a cloud; then adopt a managed KMS behind it, where its latency and availability no longer matter for whether an owner gets woken up.

Doing A first, on today's code, would be trading one documented risk for an undocumented one in the path that matters most.

**Until then:** `scripts/rotate-encryption-key.ts` makes the key rotatable without data loss, which is the difference between "we should rotate" and "we can". That is not a fix for issue #9 — it is what makes living with issue #9 survivable while this gets decided.
