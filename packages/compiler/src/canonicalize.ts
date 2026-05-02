// Canonical JSON form per LSML 1.0 §3 — deterministic stringification used for
// content-addressing scenes by sha256.
//
// Rules:
//   1. UTF-8 encoding (handled by Node's default)
//   2. Object keys sorted lexicographically at every nesting level
//   3. No insignificant whitespace (no newlines/tabs)
//   4. Numbers in shortest decimal form (JSON.stringify default)
//   5. The `scene_version` field MUST be set to all-zeros during hashing,
//      then replaced with `sha256:<hash>`.

export const ZERO_HASH = "sha256:" + "0".repeat(64);

export function canonicalize(value: unknown): string {
  return stringify(value);
}

/** Compute the sha256 content hash of a bundle, then return a copy with
 *  `scene_version` set to that hash. Uses Node's built-in `crypto.subtle`
 *  (Node ≥ 18) or the browser's `window.crypto.subtle`. */
export async function hashBundle<T extends { scene_version: string }>(bundle: T): Promise<T> {
  const stub = { ...bundle, scene_version: ZERO_HASH };
  const canonical = canonicalize(stub);
  const bytes = new TextEncoder().encode(canonical);
  const subtle = getSubtle();
  const digest = await subtle.digest("SHA-256", bytes);
  const hex = bytesToHex(new Uint8Array(digest));
  return { ...bundle, scene_version: `sha256:${hex}` };
}

function stringify(v: unknown): string {
  if (v === null) return "null";
  if (typeof v === "boolean" || typeof v === "number") return JSON.stringify(v);
  if (typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) {
    return "[" + v.map(stringify).join(",") + "]";
  }
  if (typeof v === "object") {
    const obj = v as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + stringify(obj[k])).join(",") + "}";
  }
  // undefined / function / symbol — JSON has no representation; drop.
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
  // Node ≥ 18 exposes crypto.subtle on globalThis; browsers via window.crypto.
  const c = (globalThis as unknown as { crypto?: { subtle?: SubtleLike } }).crypto;
  if (!c?.subtle) {
    throw new Error("compiler: crypto.subtle not available — Node >= 18 or browser required");
  }
  return c.subtle;
}
