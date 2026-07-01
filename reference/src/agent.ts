// Reference agent (client) — spec §2.1, §6, §9.2/§9.3.
//
// Models the ephemeral resume flow: the agent seals state before submitting, then
// a (possibly new) process calls `onResume` when a signed Response arrives by push
// or pull. onResume verifies the signature, deduplicates, and opens the sealed
// state — treating everything on the return leg as untrusted until verified.

import {
  buildInboundSignedContext,
  buildSignedContext,
  computeDirectivePayloadSha256,
  computePayloadSha256,
  verifyInbound,
  verifyResponse,
} from "./signing.js";
import { openState } from "./state-seal.js";
import { validateInboundMessage } from "./envelope.js";
import type { A2hResponse, DirectiveTo, InboundDirective, JsonObject, Resolution } from "./types.js";

export interface ParsedSignature {
  t: string;
  jti: string;
  v1: string;
}

/** Parse an `MA2H-Signature: t=..,jti=..,v1=..` header. */
export function parseSignatureHeader(header: string): ParsedSignature {
  const body = header.replace(/^MA2H-Signature:\s*/i, "");
  const parts = new Map<string, string>();
  for (const kv of body.split(",")) {
    const eq = kv.indexOf("=");
    if (eq > 0) parts.set(kv.slice(0, eq).trim(), kv.slice(eq + 1).trim());
  }
  const t = parts.get("t");
  const jti = parts.get("jti");
  const v1 = parts.get("v1");
  if (t === undefined || jti === undefined || v1 === undefined) {
    throw new Error("malformed MA2H-Signature header");
  }
  return { t, jti, v1 };
}

export type ResumeResult =
  | { acted: true; resolution: Resolution; state: JsonObject | null; value?: string | JsonObject }
  | { acted: false; reason: string };

export interface AgentOptions {
  /** This agent's own callback URL (bound into the signature). */
  callbackUrl: string;
  /** Key used to verify the Hub's Response signature. */
  callbackKey: string;
  /** Agent-owned, Hub-invisible key for sealing/opening `state` (32 bytes). */
  sealKey: Buffer;
  windowSeconds?: number;
  /**
   * Key used to verify the Hub's inbound directive signature (§9.7). MAY differ from `callbackKey`
   * (§9.7 allows same or distinct); defaults to `callbackKey` when omitted.
   */
  directiveKey?: string;
  /**
   * This agent's own `agent:<id>` identity (spec §13.4). REQUIRED to consume the inbound leg: after
   * verifying the signature, `receiveDirective` confirms `directive.to` addresses THIS agent, so a
   * directive validly signed for another agent is refused even if it reaches this stream (the webhook
   * channel has no Hub-side mailbox gate). Not needed for the response leg (`onResume`).
   */
  agentId?: DirectiveTo;
}

export type DirectiveResult =
  | {
      acted: true;
      /** The directive, projected to its known schema fields — any unsigned unknown field is stripped. */
      directive: InboundDirective;
      /**
       * Finalize dedup (spec §13.4). On accept the `id` is **reserved** (in-flight) so a concurrent
       * overlapping delivery — webhook + poll, or a redelivery past the visibility timeout — is deduped
       * before either completes. The caller invokes `commit()` only AFTER it has durably processed the
       * directive (verify -> act -> `commit()` -> ack), promoting the reservation to a permanent dedup.
       */
      commit: () => void;
      /**
       * Abandon the in-flight reservation so a later redelivery may retry (spec §13.4) — for a caller
       * that failed to process but is still alive. On a crash the in-memory reservation is simply lost,
       * so a redelivery to a fresh process retries (at-least-once); an idempotent side effect or a
       * persisted dedup set gives at-most-once across a restart.
       */
      release: () => void;
    }
  | { acted: false; reason: string };

/** Project a directive to its known schema fields, dropping any unsigned unknown property (§10, §13.4). */
function sanitizeDirective(d: InboundDirective): InboundDirective {
  const out: InboundDirective = {
    ma2h_version: d.ma2h_version,
    type: "directive",
    id: d.id,
    from: d.from,
    to: d.to,
    created_at: d.created_at,
    title: d.title,
  };
  if (d.body !== undefined) out.body = d.body;
  if (d.priority !== undefined) out.priority = d.priority;
  if (d.tags !== undefined) out.tags = d.tags;
  if (d.context !== undefined) out.context = d.context;
  if (d.expires_at !== undefined) out.expires_at = d.expires_at;
  if (d.sensitive !== undefined) out.sensitive = d.sensitive;
  return out;
}

export class Agent {
  private readonly seen = new Set<string>();
  /** At-most-once cache of directive ids the caller has COMMITTED (durably processed) — spec §13.4. */
  private readonly seenDirectives = new Set<string>();
  /** Directive ids currently RESERVED (accepted, not yet committed/released) — the in-flight guard. */
  private readonly inFlightDirectives = new Set<string>();
  /**
   * Replay cache of directive signature `jti`s already seen (spec §9.7). Rejects an exact-bytes
   * signature replay independently of the `id` business-dedup. In-process and unbounded here (the
   * minimal reference); a production agent bounds it with a TTL >= the replay window.
   */
  private readonly seenDirectiveJti = new Set<string>();
  private readonly opts: AgentOptions;

  constructor(opts: AgentOptions) {
    this.opts = opts;
  }

  /** Handle a Response delivered by push (or fetched by pull). At-most-once. */
  onResume(response: A2hResponse, signatureHeader: string, nowMs?: number): ResumeResult {
    let sig: ParsedSignature;
    try {
      sig = parseSignatureHeader(signatureHeader);
    } catch (e) {
      return { acted: false, reason: (e as Error).message };
    }

    const sc = buildSignedContext({
      ma2h_version: response.ma2h_version,
      callback_url: this.opts.callbackUrl,
      id: response.in_reply_to,
      in_reply_to: response.in_reply_to,
      jti: sig.jti,
      // §9.2 (issue #7): RECOMPUTE the payload digest from the payload we actually received,
      // so a tampered value/comment/actor/state diverges the digest and fails verification.
      payload_sha256: computePayloadSha256(response.response, response.state),
      resolution: response.resolution,
      resolution_id: response.resolution_id,
      resolved_at: response.response?.resolved_at ?? "",
      t: sig.t,
    });
    const verified = verifyResponse(sc, sig.v1, {
      key: this.opts.callbackKey,
      now: nowMs ?? Date.now(),
      ...(this.opts.windowSeconds !== undefined ? { windowSeconds: this.opts.windowSeconds } : {}),
    });
    if (!verified.ok) return { acted: false, reason: `signature: ${verified.reason}` };

    const dedupKey = `${response.in_reply_to}::${response.resolution_id}`;
    if (this.seen.has(dedupKey)) return { acted: false, reason: "duplicate delivery (already acted)" };

    // Open sealed state ONLY after signature verification; reject tamper.
    let state: JsonObject | null = null;
    const sealed = response.state?.["sealed"];
    if (typeof sealed === "string") {
      try {
        state = openState(sealed, this.opts.sealKey);
      } catch (e) {
        return { acted: false, reason: (e as Error).message };
      }
    }

    this.seen.add(dedupKey); // commit only once we will actually act
    return {
      acted: true,
      resolution: response.resolution,
      state,
      ...(response.response?.value !== undefined ? { value: response.response.value } : {}),
    };
  }

  /**
   * Handle a directive drained from the mailbox (or pushed by webhook). Verifies the §9.7 signature by
   * RECOMPUTING `payload_sha256` from the directive it received (so a tampered from/to/body diverges the
   * digest), enforces the replay window, and deduplicates on the directive `id` (§13.4) so a redelivered
   * directive is acted on at most once. Untrusted until verified.
   */
  receiveDirective(directive: InboundDirective, signatureHeader: string, nowMs?: number): DirectiveResult {
    // §13.4: a conformant inbound consumer MUST know its own identity to check the addressee.
    const self = this.opts.agentId;
    if (self === undefined) {
      return { acted: false, reason: "agent identity (agentId) not configured — cannot verify the directive addressee (§13.4)" };
    }

    // Validate SHAPE first (before any hashing): a malformed wire object (e.g. missing `title`) would
    // otherwise reach computeDirectivePayloadSha256 and throw in the JCS canonicalizer instead of a clean
    // refusal. The schema also forbids `request`/`action`/`state` — `payload_sha256` binds only the
    // content fields, so an on-path injector can add cross-type data without breaking the signature.
    const shape = validateInboundMessage(directive);
    if (!shape.valid) return { acted: false, reason: `invalid directive: ${shape.errors.join("; ")}` };

    let sig: ParsedSignature;
    try {
      sig = parseSignatureHeader(signatureHeader);
    } catch (e) {
      return { acted: false, reason: (e as Error).message };
    }

    const sc = buildInboundSignedContext({
      from: directive.from,
      id: directive.id,
      jti: sig.jti,
      ma2h_version: directive.ma2h_version,
      // §9.7: recompute from the directive we actually received — never trust a transmitted digest.
      payload_sha256: computeDirectivePayloadSha256(directive),
      t: sig.t,
      to: directive.to,
    });
    const verified = verifyInbound(sc, sig.v1, {
      key: this.opts.directiveKey ?? this.opts.callbackKey,
      now: nowMs ?? Date.now(),
      ...(this.opts.windowSeconds !== undefined ? { windowSeconds: this.opts.windowSeconds } : {}),
    });
    if (!verified.ok) return { acted: false, reason: `signature: ${verified.reason}` };

    // §13.4: confirm this directive is addressed to THIS agent. The signature binds `to`, so a valid
    // signature proves the Hub intended a specific addressee — but only the recipient checking
    // `to === self` stops a directive validly signed for agent:X from being acted on by agent:Y (the
    // webhook channel has no Hub-side mailbox gate; the pull mailbox enforces this Hub-side too).
    if (directive.to !== self) {
      return { acted: false, reason: `addressee mismatch: directive.to ${directive.to} != ${self}` };
    }

    // §9.7: reject an exact-bytes signature replay (same jti) independently of the id business-dedup.
    if (this.seenDirectiveJti.has(sig.jti)) {
      return { acted: false, reason: "replay: jti already seen" };
    }
    // id dedup — committed (already processed) beats in-flight (a concurrent/overlapping delivery).
    if (this.seenDirectives.has(directive.id)) {
      return { acted: false, reason: "duplicate delivery (already acted)" };
    }
    if (this.inFlightDirectives.has(directive.id)) {
      return { acted: false, reason: "duplicate delivery (in flight)" };
    }

    // Commit the jti now — the same signed bytes must never be re-accepted. RESERVE the id in-flight so
    // a concurrent same-id delivery is deduped before either completes; the caller promotes it to a
    // permanent dedup via commit() after durable processing, or release()s it to allow a retry (§13.4).
    this.seenDirectiveJti.add(sig.jti);
    const id = directive.id;
    this.inFlightDirectives.add(id);
    return {
      acted: true,
      directive: sanitizeDirective(directive), // §10/§13.4: strip any unsigned unknown field
      commit: () => {
        this.seenDirectives.add(id);
        this.inFlightDirectives.delete(id);
      },
      release: () => this.inFlightDirectives.delete(id),
    };
  }
}
