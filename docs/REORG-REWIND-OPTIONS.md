# Reorg rewind — options, not a decision

**Status: open design question. Nothing here is implemented.** This document exists so the decision gets made deliberately instead of by default, and so whoever makes it can see what it costs.

Written 2026-10-16, after `scripts/verify-chain.ts` measured each chain's own finality milestones and the measurement invalidated the assumption the current design rests on.

---

## The problem, stated precisely

The monitor's cursor only moves forward. `lastCheckedBlock` advances after a successful cycle and is never walked back. So:

1. A balance drop or a `TransferBlocked` is observed at some block.
2. The alert fires — a phone call, a push notification.
3. The chain reorganises. That block is no longer part of the canonical chain. **The event never happened.**
4. Nothing retracts the alert. The owner was woken up for something that did not occur, and the dashboard history still shows it as real.

`minConfirmations` is the current defence: wait N blocks before trusting an observation. The measurement shows that defence is not doing what it appears to.

## Why the current defence does not hold

Measured 2026-10-16 (`scripts/verify-chain.ts`, section 6 — reproducible):

| Chain | `safe` behind `latest` | `finalized` behind | What our depth of 3 buys |
|---|---|---|---|
| Base | ~7–21 blocks (14–42 s) | ~471 (~16 min) | ~6 s |
| Arbitrum One | ~2 600 blocks (~11 min) | ~3 900 (~17 min) | ~0.75 s |
| Ethereum L1 | ~50 blocks (~10 min) | ~77 (~15 min) | ~36 s |

**On all three, a depth of 3 is shallower than the point the chain itself still considers reversible.** On Arbitrum by roughly three orders of magnitude. The number was never measuring what it appeared to measure.

And on an L2 there is a second layer the block count cannot see at all: a block that is settled on the L2 can still disappear if the corresponding batch on L1 reorganises. Counting L2 blocks does not observe that event.

---

## The trade, in one sentence

**Deeper confirmation buys fewer false alerts and pays for them in alert latency** — and this is a product whose entire value is telling an owner quickly that their treasury is moving.

Eleven minutes of silence on Arbitrum is not a tuning detail. It is eleven minutes during which the thing the product exists to warn about proceeds unannounced.

---

## Option A — Raise the depth to the chain's `safe` milestone

Use each chain's own `safe` tag instead of `latest − N`.

**For:** Correct by the chain's own definition. No new concepts. Small change: `getConfirmedBlockNumber` reads `blockTag: "safe"`.

**Against:** Alert latency becomes ~11 min (Arbitrum), ~10 min (Ethereum), ~40 s (Base). For the product's central scenario that is likely disqualifying. Also not uniform: the same product would have wildly different responsiveness per chain, which is hard to explain to an owner and worse to put in a threshold UI.

**Honest note:** this is the option that makes the *documentation* easiest to defend and the *product* worst.

## Option B — Alert early, then retract

Keep alerting at a shallow depth. Track delivered alerts against the block that produced them. When a later cycle finds that block is no longer canonical, mark the alert as retracted in the dashboard, and optionally send a follow-up.

**For:** Preserves the speed that justifies the product. Matches how the owner actually uses it: the alert is a prompt to go look, and "false alarm" is a recoverable outcome. It also fits the existing answer loop — the owner already answers **"was this you?"**, so "this turned out not to have happened" is the same surface.

**Against:** Genuinely more machinery. Needs the block hash, not just the number, stored per delivered alert; needs a check that the stored hash is still canonical; needs a retraction path in the dashboard and a decision about whether to re-contact someone already woken at 3am. A retraction that itself arrives by phone call is its own problem.

**Open sub-question:** does a retraction notify, or only annotate the history? Notifying twice for one non-event may be worse than annotating quietly.

## Option C — Alert early, confirm later, escalate on confirmation

Two-stage: a shallow observation sends a low-severity notice; the same event surviving to `safe` escalates to the critical channel (phone call).

**For:** The expensive, intrusive channel is only spent on events the chain has stopped disputing. The owner still learns immediately through the cheap channel.

**Against:** Inverts the current severity model, where severity comes from the *size* of the anomaly (`detection-rules.ts`), not its age. Two concepts of severity in one system is how alerting products become unexplainable. And a drain that completes in under eleven minutes gets its phone call after the money is gone.

## Option D — Do nothing, and say so

Keep the forward-only cursor, keep depth 3, and state plainly in `SECURITY.md` that an alert can describe an event that a reorg later erased, and that the system will not retract it.

**For:** Costs nothing to build. Honest. For a product with one monitored testnet account and no paying customers, the real-world incidence is approximately zero.

**Against:** It is a known defect with a known consequence, left in place. The moment there is a real customer on a real L2, it stops being theoretical.

---

## What I would want before choosing

1. **How often does this actually bite?** None of the above is grounded in a measured reorg rate for these chains at depth 3. That is measurable: sample `latest` repeatedly, store block hashes, and count how often a hash at depth 3 is later replaced. A day of sampling would turn this entire document from reasoning into evidence.
2. **What does the owner want at 3am?** This is the kind of question `docs/FASE1-INTERVIEW-SCRIPT.md` exists to ask. "Would you rather be woken for something that turns out not to have happened, or told eleven minutes late?" is a better interview question than anything about thresholds.

Until at least (1) exists, every option above is an argument, not a finding — and this project's standard is that a claim without measurement does not get shipped as a decision.

## Recommendation

**Measure first (step 1), interview second (step 2), then choose — and in the meantime, Option D with the limitation written down**, which is what the code already does except for the writing-down part.

Of the four, **Option B** is the one that fits the product's logic best, and I would expect the measurement to support it. But expecting is not knowing, and the last time this project guessed at a confirmation number it got one that was three orders of magnitude off.
