// Minimal in-memory reference Hub — spec §7, §8, §9.1/§9.2.
//
// Not a production Hub (no persistence, no real HTTP, no SSRF egress). It exists
// to demonstrate the protocol end-to-end and to host the lifecycle + signing
// behaviour the spec requires. "Push delivery" is modelled as an in-process
// `onDeliver` callback rather than an HTTP POST.

import { newJti, newMessageId, newResolutionId } from "./ids.js";
import { applyResolution, type MessageRecord } from "./lifecycle.js";
import { buildSignedContext, signResponse } from "./signing.js";
import { validateMessage } from "./envelope.js";
import type {
  A2hMessage,
  A2hResponse,
  Actor,
  AskMessage,
  Callback,
  JsonObject,
  Resolution,
  Status,
  SubmitAck,
  TaskMessage,
} from "./types.js";

export class HubError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HubError";
  }
}

export interface DeliveredPush {
  callback: Extract<Callback, { mode: "push" }>;
  response: A2hResponse;
  /** The `A2H-Signature` header the agent verifies. */
  signature: string;
}

export interface HubOptions {
  signingKey: string;
  baseUrl?: string;
  now?: () => number;
  onDeliver?: (push: DeliveredPush) => void;
}

export interface ResolveInput {
  actor: Actor;
  resolution: Resolution;
  value?: string | JsonObject;
  comment?: string;
}

export type GetResult = (A2hMessage & { id: string; status: Status; response?: A2hResponse }) | null;

export class Hub {
  private readonly store = new Map<string, MessageRecord>();
  private readonly signingKey: string;
  private readonly baseUrl: string;
  private readonly now: () => number;
  private readonly onDeliver: ((push: DeliveredPush) => void) | undefined;

  constructor(opts: HubOptions) {
    this.signingKey = opts.signingKey;
    this.baseUrl = opts.baseUrl ?? "https://hub.example";
    this.now = opts.now ?? ((): number => Date.now());
    this.onDeliver = opts.onDeliver;
  }

  submit(message: A2hMessage): SubmitAck {
    const v = validateMessage(message);
    if (!v.valid) throw new HubError("validation_error", `invalid message: ${v.errors.join("; ")}`);
    const id = newMessageId();
    const isNotify = message.type === "notify";
    const record: MessageRecord = {
      id,
      message,
      status: isNotify ? "delivered" : "open",
      createdAtMs: this.now(),
      expiresAtMs: message.expires_at ? Date.parse(message.expires_at) : null,
      resolution_id: null,
      response: null,
    };
    this.store.set(id, record);
    return {
      id,
      status: isNotify ? "delivered" : "open",
      poll_url: `${this.baseUrl}/v1/messages/${id}`,
      review_url: `${this.baseUrl}/inbox/${id}`,
    };
  }

  get(id: string): GetResult {
    const r = this.store.get(id);
    if (!r) return null;
    return { ...r.message, id: r.id, status: r.status, ...(r.response ? { response: r.response } : {}) };
  }

  /** Human/inbox resolution. Enforces fail-closed authz + expiry-vs-answer precedence. */
  resolve(id: string, input: ResolveInput, nowMs?: number): A2hResponse {
    const record = this.store.get(id);
    if (!record) throw new HubError("not_found", `unknown message: ${id}`);
    if (record.message.type === "notify") {
      throw new HubError("validation_error", "notify is not resolvable");
    }
    if (record.status !== "open") return record.response as A2hResponse; // first-terminal-wins

    const t = nowMs ?? this.now();
    this.assertAuthorized(record.message, input.actor);

    // expiry-vs-answer: an answer strictly after expires_at loses to the default.
    if (record.expiresAtMs !== null && t > record.expiresAtMs) {
      return this.applyDefaultExpiry(record, t);
    }

    const res = applyResolution(record, {
      resolution: input.resolution,
      actor: input.actor,
      resolved_at: new Date(t).toISOString(),
      resolution_id: newResolutionId(),
      ...(input.value !== undefined ? { value: input.value } : {}),
      ...(input.comment !== undefined ? { comment: input.comment } : {}),
      ...(record.message.state !== undefined ? { state: record.message.state } : {}),
    });
    if (res.applied) this.deliver(record);
    return record.response as A2hResponse;
  }

  /** Expiry sweep for one message. Returns the Response if it expired now, else null. */
  expire(id: string, nowMs?: number): A2hResponse | null {
    const record = this.store.get(id);
    if (!record) return null;
    const t = nowMs ?? this.now();
    if (record.status !== "open") return record.response;
    if (record.expiresAtMs === null || t <= record.expiresAtMs) return null;
    return this.applyDefaultExpiry(record, t);
  }

  private applyDefaultExpiry(record: MessageRecord, nowMs: number): A2hResponse {
    if (record.status !== "open") return record.response as A2hResponse;
    const dflt =
      record.message.type === "ask" ? record.message.request.default_on_expire : undefined;
    applyResolution(record, {
      resolution: "expired",
      actor: "system:default_on_expire",
      defaulted: true,
      resolved_at: new Date(nowMs).toISOString(),
      resolution_id: newResolutionId(),
      ...(dflt !== undefined && dflt !== null ? { value: dflt } : {}),
      ...(record.message.state !== undefined ? { state: record.message.state } : {}),
    });
    this.deliver(record);
    return record.response as A2hResponse;
  }

  private assertAuthorized(message: AskMessage | TaskMessage, actor: Actor): void {
    const allowed =
      message.type === "ask" ? message.request.allowed_resolvers : message.action.allowed_resolvers;
    const submitter: Actor = `agent:${message.agent.id}`;
    const permitted = allowed ? allowed.includes(actor) : actor === submitter; // fail-closed default
    if (!permitted) {
      throw new HubError("not_authorized", `resolver ${actor} is not permitted for this message`);
    }
  }

  private callbackOf(message: A2hMessage): Callback | undefined {
    if (message.type === "ask") return message.request.callback;
    if (message.type === "task") return message.action.callback;
    return undefined;
  }

  private deliver(record: MessageRecord): void {
    const response = record.response;
    if (!response || !this.onDeliver) return;
    const callback = this.callbackOf(record.message);
    if (!callback || callback.mode !== "push") return; // pull mode: agent will GET
    const sc = buildSignedContext({
      a2h_version: response.a2h_version,
      callback_url: callback.url,
      id: record.id,
      in_reply_to: response.in_reply_to,
      jti: newJti(),
      resolution: response.resolution,
      resolution_id: response.resolution_id,
      resolved_at: response.response?.resolved_at ?? new Date(this.now()).toISOString(),
      t: Math.floor(this.now() / 1000),
    });
    const { header } = signResponse(sc, { key: this.signingKey });
    this.onDeliver({ callback, response, signature: header });
  }
}
