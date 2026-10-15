# Evaluation access — for judges and their AI agents

**This page exists for one reason: letting a hackathon judge, or an automated agent acting for one, evaluate VILIGION without spending their time on authenticator setup.** It is not a product feature and it is not how a customer account works.

**It stops working on 2026-11-14.** That date is a constant in the source (`JUDGE_ACCESS_EXPIRES_AT` in `src/dashboard/judge-access.ts`), not a setting in a hosting panel, so anyone reading this repository can verify it. After it passes, the correct password stops working and reopening requires a commit.

---

## Two ways in, and when to use each

| | Evaluation login | Full login |
|---|---|---|
| Needs an authenticator app? | **No** — username + password | Yes — username + password + 6-digit TOTP |
| Browse everything | Yes | Yes |
| Register a monitored account | Yes | Yes |
| Edit alert thresholds | Yes | Yes |
| Change where alerts are sent | **No** | Yes |
| Fire a test alert | **No** | Yes |
| View `/recipients` | **No** | Yes |

**The evaluation login is a convenience, not a ceiling.** Both sets of credentials are in the submission form. If you want to exercise the parts the evaluation login blocks, use the full login — including from an agent, since a TOTP code is a pure computation from the shared secret (see "For AI agents" below).

---

## Why the two exclusions

**Changing where alerts go.** This project's submission states that changing an alert destination requires password *and* TOTP. If a single-factor login could do it, that statement would be false. Keeping it out is how the claim stays true — and a security product that contradicts its own documentation is worth less than one with a smaller feature set.

**Firing a test alert.** It places a **real phone call to the owner's real number** and spends credit on their Twilio account, once per judge who clicks. `/alerts/preview` shows the exact text of every channel without sending anything, and `/alerts` holds the history of alerts that genuinely fired.

**Reading `/recipients`.** That page lists alert destinations in full, including a real phone number. This is a product whose entire thesis is not linking a phone number to a treasury; exposing it to an evaluation session would contradict the thesis in the most direct way possible. The refusal page says so.

---

## For AI agents

### Allowed, with the evaluation login

```
GET  /                     landing
GET  /dashboard            monitoring strip: "last cycle Xs ago" — measured, not decorative
GET  /alerts               alert history (real production alerts)
GET  /alerts/preview       exact content of every channel, sends nothing
GET  /thresholds           alert thresholds, as configured
GET  /accounts             monitored accounts
GET  /healthz              status + uptime, no auth needed
GET  /logout

POST /accounts             register a monitored account
POST /thresholds           edit thresholds
```

### Refused, with the evaluation login

```
GET  /recipients           alert destinations (real phone number)
POST /recipients           change alert destination
POST /recipients/test      fire a test alert (real phone call)
POST /push/subscribe       register a device as an alert destination
     anything else that writes
```

Refusals return **HTTP 403 with an HTML page explaining which rule applied** — not a bare error. If your agent gets a 403, read the page; it says what is still available.

The rule is an **allow-list on writes**, evaluated at a single point before routing (`judgeMayAccess`). A write route that does not appear above is refused, including ones added after this document was written.

### Things not reachable at all, by any login

- `/admin/status` and `/admin/waitlist` need a bearer token that is not shared with judges — a session never grants them, whatever its type.
- Environment variables, secrets, RPC URLs, API keys and infrastructure addresses are never rendered in any page or API response. `/healthz` returns `{status, uptimeSeconds}` and nothing else.
- Source code is not served by the application. Read it on GitHub — the repository is public and MIT.
- Alert content never contains a balance, an address or a monetary figure on any channel. That is enforced by an automated test (`src/alerts/alert-content-policy.test.ts`), not by review.

### Please don't

- **Do not register a real phone number** as an alert recipient, even with the full login. It places real calls on the owner's Twilio account.
- **Do not load-test.** This is a single small instance that also runs the live treasury monitors; hammering it degrades the thing you are evaluating. The login endpoint is rate-limited to 5 attempts per 15 minutes per identifier.

---

## Everything is logged

Every request made by an evaluation session is written to the server log, allowed or refused:

```
[jurado] ok      GET /dashboard
[jurado] NEGADO  POST /recipients/test
```

The owner reads it with `railway logs --service viligion-app` and filters on `[jurado]`. This is stated here rather than hidden: an access path without an audit trail is one nobody can review afterwards.

---

## Honest limits of this mechanism

- It is still **a password granting read access to a dashboard showing a real monitored address and real alert history**. It is not a pattern to copy for a production account holding customer data, and it is not presented as one. It exists for a demonstration account on a testnet, with an expiry date attached.
- The only barrier on this path is the password and the login rate limiter — there is no second factor by design. A password shorter than 12 characters is refused at configuration time for that reason.
- The evaluation session can register accounts and edit thresholds, so **a judge can change what a later judge sees**. On a demo account that is an acceptable trade for being able to evaluate the product at all; on a real account it would not be.

See [`SECURITY.md`](../SECURITY.md) for the project's full threat model, and [`src/dashboard/judge-access.ts`](../src/dashboard/judge-access.ts) for the enforcement, which is about 200 lines and worth reading if you are judging the security claims.
