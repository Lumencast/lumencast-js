// Canonical sha256 hashing per LSML 1.0 §3.
// Duplicated from @lumencast/compiler to avoid a circular workspace dep
// (compiler depends on protocol). Keep the two in sync.

const ZERO_HASH = "sha256:" + "0".repeat(64);

export function canonicalize(value: unknown): string {
  return stringify(value);
}

/** Hash an inline LSML bundle, returning the `sha256:<hex>` identity. */
export async function hashInlineBundle(inline: unknown): Promise<string> {
  // Per spec: scene_version is set to all zeros during hashing.
  const stub =
    typeof inline === "object" && inline !== null && !Array.isArray(inline)
      ? { ...(inline as Record<string, unknown>), scene_version: ZERO_HASH }
      : inline;
  const canonical = canonicalize(stub);
  const bytes = new TextEncoder().encode(canonical);
  const subtle = getSubtle();
  const digest = await subtle.digest("SHA-256", bytes);
  return "sha256:" + bytesToHex(new Uint8Array(digest));
}

function stringify(v: unknown): string {
  if (v === null) return "null";
  if (typeof v === "boolean" || typeof v === "number") return JSON.stringify(v);
  if (typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(stringify).join(",") + "]";
  if (typeof v === "object") {
    const obj = v as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + stringify(obj[k])).join(",") + "}";
  }
  return "null";
}

function bytesToHex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

interface SubtleLike {
  digest(algorithm: "SHA-256", data: Uint8Array): Promise<ArrayBuffer>;
}

function getSubtle(): SubtleLike {
  const c = (globalThis as unknown as { crypto?: { subtle?: SubtleLike } }).crypto;
  if (!c?.subtle) {
    throw new Error("conformance: crypto.subtle not available — Node >= 18 or browser required");
  }
  return c.subtle;
}
