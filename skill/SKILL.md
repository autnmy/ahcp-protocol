---
name: a2h
description: >-
  Reach a human from an agent via the A2H (Agent-to-Human) Protocol — send a
  status/summary the human can read (notify), ask a human a decision and resume
  on their answer (ask), or assign a manual action a human performs out-of-band
  (task). Use whenever an agent needs human triage, approval, a decision, sign-off,
  or to report progress to a person — especially across an exit/re-invoke boundary
  (GitHub Actions, CLI runs, cron). Triggers: "ask a human", "get approval",
  "notify me", "human in the loop", "escalate to a person", "report status to".
---

# A2H — Agent-to-Human integration

This skill lets you (an agent) talk to a human through an **A2H Hub** correctly, in one shot. The protocol
has three verbs and a small set of non-negotiable trust rules. Get the rules right and the rest is filling
in a JSON envelope.

**Authority order** (when in doubt, defer up this list):
1. [`spec/v0.2.md`](../spec/v0.2.md) — the normative spec. The final word.
2. [`reference/`](../reference) — `@a2h/reference`, a strongly-typed working implementation. Mirror it.
3. [`examples/`](../examples) — copy-paste envelope templates.
4. [`conformance/`](../conformance) — the tests your envelopes must pass.

## Mental model

```
  you (agent) ──POST /v1/messages──▶  Hub  ──▶ human inbox
              ◀──signed push / GET──         ◀── human resolves
```

- **`notify`** — FYI. No response. (a daily digest, a status update)
- **`ask`** — a decision you act on. The human's answer routes back to you. (ship/hold, approve/deny)
- **`task`** — a manual action a human does in the world, then marks done. (rotate a secret)

You POST to a Hub (find its base URL + limits via `GET /.well-known/a2h`). The Hub assigns the message
`id` and returns a `202`. For `ask`/`task`, the answer comes back by **push** (the Hub POSTs a signed
Response to your `callback.url`) or **pull** (you `GET /v1/messages/{id}`).

## The 8 non-negotiables (read before sending anything)

1. **The Hub assigns `id`.** Read it from the `202` ack — never invent it. Use the optional `client_ref`
   for your own correlation label.
2. **`idempotency_key` is REQUIRED on `ask`/`task`.** If the `202` is lost, retry with the **same** key
   until you see a `202` or `409` — this is what stops a duplicate human decision.
3. **`state` is UNTRUSTED on the way back.** If you need to resume, put your resume context in `state`,
   **AEAD-sealed** with a key the Hub never sees (`reference/src/state-seal.ts` → `sealState`). On return,
   `openState` **verifies before use**. **Never put the seal key inside `state`** (it's circular — zero
   integrity). The key must be pre-positioned in your runtime (a CI/Actions secret), distinct from the
   callback credential.
4. **Verify the Response signature before acting.** Every pushed Response carries an `A2H-Signature`
   header. Reconstruct the `signed_context`, `verifyResponse(...)` (`reference/src/signing.ts`), reject
   bad signatures, out-of-window timestamps (±120s), and replayed `jti`.
5. **Deduplicate and act at most once.** Key on `(in_reply_to, resolution_id)`. Push + pull can both
   deliver the same answer; `resolution_id` is identical across them. Acting twice = double-deploy.
6. **Set `allowed_resolvers`.** Absent, the default is **fail-closed** (only you may resolve). List the
   human(s) who may answer: `["human:alice"]`.
7. **`callback.url` must be your own registered host** — an endpoint that re-invokes *you*. Never point it
   at a third-party API with a credential attached (that's the confused-deputy anti-pattern; see
   [`examples/callback-anti-pattern.md`](../examples/callback-anti-pattern.md)).
8. **Don't poll a `notify`** (it has no response). If a `notify` must not be silently lost, confirm it
   with a `GET /v1/messages/{id}` (a `delivered` notify is durable).

## Recipe — `notify` (status / summary)

Simplest verb. Build the envelope ([template](../examples/notify-daily-digest.json)), POST it, you're done.

```jsonc
{ "a2h_version": "0.2", "type": "notify", "created_at": "<RFC3339>",
  "agent": { "id": "you/agent", "run_id": "<this run>", "runtime": "github-actions" },
  "title": "<one line>", "body": "<markdown>", "idempotency_key": "<stable key for dedup>" }
```
→ `POST /v1/messages` → `202 { id, status: "delivered" }`. Optionally `GET` the `poll_url` to confirm it
landed.

## Recipe — `ask` (decision, with ephemeral resume)

This is the flow that makes A2H worth it. Five steps (the canonical implementation is
`reference/src/agent.ts` → `onResume`):

1. **Seal** your resume context: `state: { sealed: sealState({...}, sealKey) }`.
2. **Build** the ask ([template](../examples/ask-dev-team-decision.json)) with `request.mode`
   (`select` | `input` | `confirm`), `options`/`schema`, `permissions`, `default_on_expire`,
   `allowed_resolvers`, and a **push** `callback` to your own re-invoke URL.
3. **POST** → `202 { id }`. Then **exit** (or stay alive and poll — your choice).
4. On re-invoke (push) or poll, **verify** the signature (rule 4), **dedup** (rule 5), then
   **`openState`** to reconstruct (rule 3).
5. **Act once.** First branch on `resolution` to know *how* it ended — `answered` vs
   `declined`/`cancelled`/`expired` (fail-closed on the non-`answered` ones). Then read the human's actual
   choice from **`response.value`**: the chosen option string for `select`/`confirm`, or the input object
   for `input`. `resolution` alone is **not** the decision — `answered` doesn't tell you ship vs hold;
   `response.value` does. (For a `task`, there is no `value`; the outcome is the `resolution` itself.)

`mode=confirm` synthesizes `approve`/`deny` for you. `default_on_expire` must be one of your `options`
values. A human answer at/before `expires_at` beats the default.

## Recipe — `task` (manual action)

Build a `task` ([template](../examples/task-manual-action.json)) with an `action` block (`instructions`,
`checklist`, `verification`, `allowed_resolvers`, `callback`). The human performs it and marks it
`completed` (or `dismissed`). Learn the outcome by push or pull. No `default_on_expire` for tasks.

## Validate before you send

Never ship an envelope you haven't validated:

```bash
# CLI
cd reference && npm run a2h -- validate <your-message.json>
# or in code
import { validateMessage } from "@a2h/reference";   // ../reference/src/envelope.ts
```

Run the conformance vectors to see the rules in action: `cd reference && npm run vectors`.

## Resolution values (exhaustive)

- `ask` → `answered` | `declined` | `cancelled` | `expired`
- `task` → `completed` | `dismissed` | `expired`

There is no `ignored` (an ignored ask resolves `declined`). `cancelled` is ask-only. An expiry-defaulted
Response carries `defaulted: true` and `actor: "system:default_on_expire"`.

These are lifecycle **outcomes**, not the human's answer. For a `select`/`input`/`confirm` ask, the choice
you act on is **`response.value`** — `resolution` only tells you whether a human answered at all.

## What you do NOT decide

The Hub decides eligibility, attests `actor`, signs the Response, and enforces authz/limits. You never
trust the return leg without verifying it (rules 3–5). If you're implementing a Hub instead of a client,
`reference/src/hub.ts` is the spec-faithful in-memory reference and the [`conformance/`](../conformance)
vectors + §12 proof obligations are your acceptance tests.
