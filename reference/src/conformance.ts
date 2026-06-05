// Conformance-vector runner — executes the vectors in ../conformance/vectors/.
// Only the executable classes run here: `schema-validation` (against the published
// schemas) and the `downstream-proof` signature fixture (dp-001). `prose-audit`
// vectors are reported as skipped — they are human sign-off, not executable
// (spec §12).

import { readdirSync, readFileSync } from "node:fs";
import { validateCapability, validateMessage, validateResponse, type ValidationResult } from "./envelope.js";
import { buildSignedContext, signResponse } from "./signing.js";
import type { SignedContext } from "./types.js";

export type VectorStatus = "pass" | "fail" | "skip";
export interface VectorResult {
  id: string;
  cls: string;
  status: VectorStatus;
  detail?: string;
}
export interface VectorReport {
  results: VectorResult[];
  passed: number;
  failed: number;
  skipped: number;
}

const VECTORS_DIR = new URL("../../conformance/vectors/", import.meta.url);

function validateAgainst(target: string, data: unknown): ValidationResult {
  switch (target) {
    case "message.schema.json":
      return validateMessage(data);
    case "response.schema.json":
      return validateResponse(data);
    case "capability.schema.json":
      return validateCapability(data);
    default:
      throw new Error(`vector target not runnable: ${target}`);
  }
}

function runOne(id: string, cls: string, v: Record<string, unknown>): VectorResult {
  if (cls === "schema-validation") {
    const target = String(v["target"]);
    const expect: "valid" | "invalid" = v["expect"] === "valid" ? "valid" : "invalid";
    const res = validateAgainst(target, v["input"]);
    const got: "valid" | "invalid" = res.valid ? "valid" : "invalid";
    if (got === expect) return { id, cls, status: "pass" };
    const why = res.valid ? "" : `: ${res.errors.join("; ")}`;
    return { id, cls, status: "fail", detail: `expected ${expect}, got ${got}${why}` };
  }
  if (cls === "downstream-proof" && id.startsWith("dp-001")) {
    const sc = v["signed_context"] as SignedContext;
    const key = String(v["test_key"]);
    const { v1, canonical } = signResponse(buildSignedContext(sc), { key });
    const ok = v1 === v["v1"] && canonical === v["canonical_jcs"];
    return ok ? { id, cls, status: "pass" } : { id, cls, status: "fail", detail: "signature/canonical mismatch" };
  }
  if (cls === "prose-audit") {
    return { id, cls, status: "skip", detail: "manual human sign-off (not executable)" };
  }
  return { id, cls, status: "skip", detail: "no executable check for this vector class" };
}

export function runVectors(dir: URL = VECTORS_DIR): VectorReport {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort();
  const results: VectorResult[] = [];
  for (const file of files) {
    const v = JSON.parse(readFileSync(new URL(file, dir), "utf8")) as Record<string, unknown>;
    const id = typeof v["id"] === "string" ? v["id"] : file;
    const cls = typeof v["class"] === "string" ? v["class"] : "unknown";
    results.push(runOne(id, cls, v));
  }
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  for (const r of results) {
    if (r.status === "pass") passed++;
    else if (r.status === "fail") failed++;
    else skipped++;
  }
  return { results, passed, failed, skipped };
}
