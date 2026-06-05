// RFC 8785 JSON Canonicalization Scheme (JCS) — minimal reference covering the
// JSON subset A2H signs (spec §9.2 `signed_context`: a flat object of strings).
//
// Production implementations SHOULD use a vetted JCS library for full IEEE-754
// number formatting (RFC 8785 §3.2.2.3) and Unicode normalization. For A2H's
// signed_context — whose values are protocol-controlled strings — this is
// byte-exact with conformant JCS.

export function canonicalize(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) throw new Error("JCS: non-finite number");
      return JSON.stringify(value);
    case "string":
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) return "[" + value.map(canonicalize).join(",") + "]";
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj).sort(); // RFC 8785: sort by UTF-16 code units
      return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalize(obj[k])).join(",") + "}";
    }
    default:
      throw new Error("JCS: unsupported type " + typeof value);
  }
}
