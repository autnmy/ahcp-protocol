import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { openState, sealState } from "../src/state-seal.js";

test("seal then open round-trips the state", () => {
  const key = randomBytes(32);
  const state = { resume_token: "node:x", n: 3, nested: { a: [1, 2, true] } };
  assert.deepEqual(openState(sealState(state, key), key), state);
});

test("tampered ciphertext is rejected (AEAD)", () => {
  const key = randomBytes(32);
  const parts = sealState({ a: "b" }, key).split(".");
  const ctBuf = Buffer.from(parts[2]!, "base64url");
  ctBuf[0] = ctBuf[0]! ^ 0xff; // deterministically corrupt a ciphertext byte
  const mutated = ctBuf.toString("base64url");
  const tampered = [parts[0], parts[1], mutated, parts[3]].join(".");
  assert.throws(() => openState(tampered, key), /integrity verification failed/);
});

test("wrong key is rejected", () => {
  const sealed = sealState({ a: "b" }, randomBytes(32));
  assert.throws(() => openState(sealed, randomBytes(32)), /integrity verification failed/);
});

test("a non-32-byte key is rejected (key-provenance guard)", () => {
  assert.throws(() => sealState({ a: "b" }, randomBytes(16)), /32 bytes/);
});
