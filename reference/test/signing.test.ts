// Proves the §9.2 signature scheme against the conformance fixture dp-001.
// If this passes, the spec's signature mechanic is real, not just specified.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildSignedContext, signResponse, verifyResponse } from "../src/signing.js";
import type { SignedContext } from "../src/types.js";

interface Dp001Vector {
  signed_context: SignedContext;
  test_key: string;
  canonical_jcs: string;
  v1: string;
  header: string;
}

const vector = JSON.parse(
  readFileSync(new URL("../../conformance/vectors/dp-001-signature.json", import.meta.url), "utf8"),
) as Dp001Vector;

const tMs = Number(vector.signed_context.t) * 1000;

test("dp-001 — reproduces the canonical JCS string", () => {
  const sc = buildSignedContext(vector.signed_context);
  assert.equal(signResponse(sc, { key: vector.test_key }).canonical, vector.canonical_jcs);
});

test("dp-001 — reproduces the expected HMAC signature and header", () => {
  const sc = buildSignedContext(vector.signed_context);
  const { v1, header } = signResponse(sc, { key: vector.test_key });
  assert.equal(v1, vector.v1);
  assert.equal(header, vector.header);
});

test("dp-001 — verify accepts the genuine signature within the window", () => {
  const sc = buildSignedContext(vector.signed_context);
  assert.deepEqual(verifyResponse(sc, vector.v1, { key: vector.test_key, now: tMs + 5000 }), {
    ok: true,
  });
});

test("dp-001 — verify rejects a tampered signed_context (resolution flipped)", () => {
  const sc = buildSignedContext({ ...vector.signed_context, resolution: "declined" });
  const res = verifyResponse(sc, vector.v1, { key: vector.test_key, now: tMs + 5000 });
  assert.equal(res.ok, false);
  assert.equal(res.ok === false && res.reason, "signature mismatch");
});

test("dp-001 — verify rejects a replay outside the ±120s window", () => {
  const sc = buildSignedContext(vector.signed_context);
  const res = verifyResponse(sc, vector.v1, { key: vector.test_key, now: tMs + 9_999_000 });
  assert.equal(res.ok, false);
  assert.match(res.ok === false ? res.reason : "", /window/);
});

test("dp-001 — verify rejects the wrong key", () => {
  const sc = buildSignedContext(vector.signed_context);
  const res = verifyResponse(sc, vector.v1, {
    key: "the-wrong-key-000000000000000000",
    now: tMs + 5000,
  });
  assert.equal(res.ok, false);
});
