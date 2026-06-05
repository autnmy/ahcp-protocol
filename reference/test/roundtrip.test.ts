// End-to-end: the exit -> human-resolve -> signed-push -> re-invoke -> verify ->
// open-state -> resume flow (spec §2.1), plus the lifecycle guarantees (§7) and
// at-most-once delivery (§6).

import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Hub, type DeliveredPush } from "../src/hub.js";
import { Agent } from "../src/agent.js";
import { sealState } from "../src/state-seal.js";
import type { A2hMessage } from "../src/types.js";

const SIGNING_KEY = "hub-signing-key-0123456789abcdef0123456789abcdef";
const RESUME_URL = "https://deploybot.example/a2h/resume";
const T0 = 1_750_000_000_000;

function makeAsk(sealKey: Buffer, t: number): A2hMessage {
  return {
    a2h_version: "0.2",
    type: "ask",
    created_at: new Date(t).toISOString(),
    agent: { id: "deploybot/dev-team", run_id: "run_1", runtime: "github-actions" },
    title: "Ship the release to prod?",
    idempotency_key: "release-ship-1",
    expires_at: new Date(t + 60_000).toISOString(),
    state: { sealed: sealState({ resume_token: "node:promote-build", pr_branch: "feat/x" }, sealKey) },
    request: {
      mode: "select",
      options: [
        { value: "ship", label: "Ship" },
        { value: "hold", label: "Hold" },
      ],
      default_on_expire: "hold",
      allowed_resolvers: ["human:alice"],
      callback: { mode: "push", url: RESUME_URL, auth: { scheme: "hmac", secret_ref: "env:K" } },
    },
  };
}

test("ask round-trip: exit -> resolve -> signed push -> re-invoke -> verify -> resume", () => {
  const sealKey = randomBytes(32);
  const deliveries: DeliveredPush[] = [];
  const hub = new Hub({ signingKey: SIGNING_KEY, now: () => T0, onDeliver: (p) => { deliveries.push(p); } });
  const agent = new Agent({ callbackUrl: RESUME_URL, callbackKey: SIGNING_KEY, sealKey });

  const ack = hub.submit(makeAsk(sealKey, T0));
  assert.equal(ack.status, "open");

  // run #1 has exited; the human resolves
  const resp = hub.resolve(
    ack.id,
    { actor: "human:alice", resolution: "answered", value: "hold", comment: "wait for review" },
    T0 + 5_000,
  );
  assert.equal(resp.resolution, "answered");

  const d = deliveries[0];
  assert.ok(d, "a signed push was delivered");
  const r = agent.onResume(d.response, d.signature, T0 + 6_000);
  assert.equal(r.acted, true);
  if (r.acted) {
    assert.equal(r.resolution, "answered");
    assert.equal(r.value, "hold");
    assert.deepEqual(r.state, { resume_token: "node:promote-build", pr_branch: "feat/x" });
  }
});

test("duplicate delivery (push + pull) — the agent acts at most once", () => {
  const sealKey = randomBytes(32);
  const deliveries: DeliveredPush[] = [];
  const hub = new Hub({ signingKey: SIGNING_KEY, now: () => T0, onDeliver: (p) => { deliveries.push(p); } });
  const agent = new Agent({ callbackUrl: RESUME_URL, callbackKey: SIGNING_KEY, sealKey });

  const ack = hub.submit(makeAsk(sealKey, T0));
  hub.resolve(ack.id, { actor: "human:alice", resolution: "answered", value: "ship" }, T0 + 1_000);
  const d = deliveries[0];
  assert.ok(d);

  const first = agent.onResume(d.response, d.signature, T0 + 2_000);
  const second = agent.onResume(d.response, d.signature, T0 + 3_000);
  assert.equal(first.acted, true);
  assert.equal(second.acted, false);
  assert.match(second.acted === false ? second.reason : "", /duplicate/);
});

test("resolve after terminal returns the first outcome (first-terminal-wins)", () => {
  const sealKey = randomBytes(32);
  const hub = new Hub({ signingKey: SIGNING_KEY, now: () => T0 });
  const ack = hub.submit(makeAsk(sealKey, T0));
  const first = hub.resolve(ack.id, { actor: "human:alice", resolution: "answered", value: "ship" }, T0 + 1_000);
  const second = hub.resolve(ack.id, { actor: "human:alice", resolution: "declined" }, T0 + 2_000);
  assert.equal(second.resolution, "answered");
  assert.equal(second.resolution_id, first.resolution_id);
});

test("notify is delivered on acceptance and durably pull-checkable", () => {
  const hub = new Hub({ signingKey: SIGNING_KEY, now: () => T0 });
  const notify: A2hMessage = {
    a2h_version: "0.2",
    type: "notify",
    created_at: new Date(T0).toISOString(),
    agent: { id: "deploybot/dev-team", run_id: "digest_1", runtime: "cloud" },
    title: "Daily digest",
    idempotency_key: "digest-1",
  };
  const ack = hub.submit(notify);
  assert.equal(ack.status, "delivered");
  const got = hub.get(ack.id);
  assert.equal(got?.status, "delivered");
});

test("a human answer at expires_at wins; one millisecond later, default wins", () => {
  const sealKey = randomBytes(32);
  const hub = new Hub({ signingKey: SIGNING_KEY, now: () => T0 });

  const atDeadline = hub.resolve(
    hub.submit(makeAsk(sealKey, T0)).id,
    { actor: "human:alice", resolution: "answered", value: "ship" },
    T0 + 60_000,
  );
  assert.equal(atDeadline.resolution, "answered");
  assert.equal(atDeadline.response?.value, "ship");

  const afterDeadline = hub.resolve(
    hub.submit(makeAsk(sealKey, T0)).id,
    { actor: "human:alice", resolution: "answered", value: "ship" },
    T0 + 60_001,
  );
  assert.equal(afterDeadline.resolution, "expired");
  assert.equal(afterDeadline.defaulted, true);
  assert.equal(afterDeadline.response?.value, "hold");
  assert.equal(afterDeadline.response?.actor, "system:default_on_expire");
});

test("a tampered state blob is rejected on resume (signature passes, AEAD catches it)", () => {
  const sealKey = randomBytes(32);
  const deliveries: DeliveredPush[] = [];
  const hub = new Hub({ signingKey: SIGNING_KEY, now: () => T0, onDeliver: (p) => { deliveries.push(p); } });
  const agent = new Agent({ callbackUrl: RESUME_URL, callbackKey: SIGNING_KEY, sealKey });

  const ack = hub.submit(makeAsk(sealKey, T0));
  hub.resolve(ack.id, { actor: "human:alice", resolution: "answered", value: "hold" }, T0 + 1_000);
  const d = deliveries[0];
  assert.ok(d);

  const st = d.response.state;
  assert.ok(st);
  const sealed = String(st["sealed"]);
  const parts = sealed.split(".");
  const ct = parts[2]!;
  const mutated = ct.slice(0, -1) + (ct.endsWith("A") ? "B" : "A");
  const tampered = { ...d.response, state: { sealed: [parts[0], parts[1], mutated, parts[3]].join(".") } };

  const r = agent.onResume(tampered, d.signature, T0 + 2_000);
  assert.equal(r.acted, false);
  assert.match(r.acted === false ? r.reason : "", /integrity/);
});
