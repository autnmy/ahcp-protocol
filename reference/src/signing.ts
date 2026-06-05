// A2H detached Response signature — spec §9.2.
//
// The Hub signs a canonical `signed_context` (NOT the raw HTTP body) so the
// signature is bound to id + resolution_id + callback_url and cannot be replayed
// across messages/endpoints. The agent verifies before acting on a pushed Response.

import { createHmac, timingSafeEqual } from "node:crypto";
import { canonicalize } from "./canonicalize.js";
import type { Resolution, SignedContext } from "./types.js";

export type SignatureAlg = "hmac-sha256" | "ed25519";

/** Fields bound by the signature, in spec order (canonicalize sorts them anyway). */
export const SIGNED_FIELDS = [
  "a2h_version",
  "callback_url",
  "id",
  "in_reply_to",
  "jti",
  "resolution",
  "resolution_id",
  "resolved_at",
  "t",
] as const satisfies ReadonlyArray<keyof SignedContext>;

export interface SignedContextParts {
  a2h_version: SignedContext["a2h_version"];
  callback_url: string;
  id: string;
  in_reply_to: string;
  jti: string;
  resolution: Resolution;
  resolution_id: string;
  resolved_at: string;
  /** Textual unix seconds; coerced to string. */
  t: string | number;
}

/** Assemble the canonical signed_context from its parts. */
export function buildSignedContext(parts: SignedContextParts): SignedContext {
  return {
    a2h_version: parts.a2h_version,
    callback_url: parts.callback_url,
    id: parts.id,
    in_reply_to: parts.in_reply_to,
    jti: parts.jti,
    resolution: parts.resolution,
    resolution_id: parts.resolution_id,
    resolved_at: parts.resolved_at,
    t: String(parts.t),
  };
}

export interface SignResult {
  canonical: string;
  v1: string;
  header: string;
}

export interface SignOptions {
  alg?: SignatureAlg;
  key: string;
}

export function signResponse(sc: SignedContext, opts: SignOptions): SignResult {
  const alg = opts.alg ?? "hmac-sha256";
  if (alg !== "hmac-sha256") throw new Error(`alg not implemented in this slice: ${alg}`);
  if (!opts.key) throw new Error("signing key required");
  const canonical = canonicalize(sc);
  const v1 = createHmac("sha256", opts.key).update(canonical).digest("base64url");
  return { canonical, v1, header: `A2H-Signature: t=${sc.t},jti=${sc.jti},v1=${v1}` };
}

export type VerifyResult = { ok: true } | { ok: false; reason: string };

export interface VerifyOptions {
  alg?: SignatureAlg;
  key: string;
  /** Agent's current time in ms (defaults to now). */
  now?: number;
  windowSeconds?: number;
}

export function verifyResponse(sc: SignedContext, v1: string, opts: VerifyOptions): VerifyResult {
  const alg = opts.alg ?? "hmac-sha256";
  if (alg !== "hmac-sha256") return { ok: false, reason: `alg not implemented: ${alg}` };
  if (!opts.key) return { ok: false, reason: "verify key required" };

  const now = opts.now ?? Date.now();
  const windowSeconds = opts.windowSeconds ?? 120;
  const t = Number(sc.t);
  if (!Number.isFinite(t)) return { ok: false, reason: "bad timestamp" };
  if (Math.abs(Math.floor(now / 1000) - t) > windowSeconds) {
    return { ok: false, reason: "outside replay window" };
  }

  const expected = createHmac("sha256", opts.key).update(canonicalize(sc)).digest();
  let got: Buffer;
  try {
    got = Buffer.from(v1, "base64url");
  } catch {
    return { ok: false, reason: "bad signature encoding" };
  }
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) {
    return { ok: false, reason: "signature mismatch" };
  }
  // NOTE: a conformant agent also rejects a replayed `jti` via a replay cache
  // (TTL >= windowSeconds). That belongs to the agent/Hub layer (planned slice).
  return { ok: true };
}
