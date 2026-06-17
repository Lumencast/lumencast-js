// Shared host + URL-scheme allowlist gate (LSML 1.2 foundation, ADR 002 #C ;
// Bastion conditions T1 + T2, threat model 2026-06-17).
//
// Every untrusted asset URL that can reach the DOM — an image-fill `src`,
// a `mask.source`-image, a `background-image: url()` — MUST pass through
// `isHostAllowed` BEFORE it is ever placed into markup. The gate is DOUBLE :
// the compiler runs it at lowering AND the runtime re-runs it at render,
// because live LSDP deltas reach the runtime without ever passing through
// the compiler (same defence-in-depth model as `css-color.ts` /
// `filter-clamp.ts`). This module is the SINGLE source of truth for that
// decision — callers (compiler `compile.ts`, runtime `image/fill/mask.tsx`)
// reuse it, they never re-implement host or scheme matching.
//
// Two independent checks, both must pass :
//
//   T2 — scheme allowlist. Only `https:` URLs reach a remote host. A bounded
//        `data:image/*` URL is allowed (inline raster, no network, no host),
//        because the cover's ~190 tiles may legitimately inline. EVERYTHING
//        else is rejected by construction : `javascript:`, `data:text/*`,
//        `data:text/html`, `file:`, `blob:`, `vbscript:`, relative URLs,
//        protocol-relative `//host`, and any scheme not on the allowlist.
//
//   T1 — host allowlist. For `https:` URLs the parsed `new URL(url).hostname`
//        MUST equal-match (case-insensitive, exact) an entry in the bundle's
//        `assets.allowedHosts`. Matching is on the PARSED hostname, never a
//        substring of the raw string — so `evil.com/trusted.com`,
//        `trusted.com.evil.com`, `trusted.com@evil.com` (userinfo),
//        `trusted-com.evil.com`, IDN/punycode look-alikes and embedded ports
//        are all rejected. An empty / absent allowlist rejects every remote
//        host (deny-by-default). `data:` URLs carry no host and skip T1.
//
// The gate is a pure boolean predicate. It NEVER throws, NEVER logs, and
// NEVER echoes the rejected URL — callers emit a diagnostic carrying only
// `{ nodeId, field, reason }` (Bastion R9). A rejected URL MUST be handled
// as "omit the asset / use the primitive's safe default", never passthrough.

/** Upper bound on the URL string we will even parse (anti-DoS ; a URL longer
 *  than this is rejected before `new URL()` runs). Generous enough for a
 *  base64 `data:image/*` thumbnail tile, bounded enough to stay linear. */
const MAX_URL_LEN = 8192;

/** The only `data:` media types we accept (T2). Raster image payloads only —
 *  never `text/*`, `text/html`, `image/svg+xml` (SVG can carry script), or an
 *  absent / wildcard media type. */
const ALLOWED_DATA_IMAGE_RE = /^data:image\/(png|jpeg|jpg|gif|webp|avif|bmp|x-icon);base64,/i;

/** Result of a host-allow decision. `allowed` is the only field a caller
 *  needs to branch on ; `reason` is a STATIC string (never the URL) suitable
 *  for a diagnostic. */
export interface HostAllowDecision {
  allowed: boolean;
  /** Static rejection reason, or `undefined` when allowed. Never the URL. */
  reason?: string;
}

/**
 * Decide whether an untrusted asset URL may reach the DOM, with a static
 * reason on rejection. Use `isHostAllowed` for the plain boolean ; use this
 * when you want to attach the reason to a diagnostic.
 *
 * @param url           the untrusted URL string from a bundle prop or a live
 *                      LSDP delta. Any non-string is rejected.
 * @param allowedHosts  the bundle's `assets.allowedHosts` (exact hostnames).
 *                      Absent / empty = deny every remote host.
 */
export function checkHostAllowed(
  url: unknown,
  allowedHosts: readonly string[] | undefined,
): HostAllowDecision {
  if (typeof url !== "string") return { allowed: false, reason: "asset url is not a string" };
  if (url.length === 0 || url.length > MAX_URL_LEN)
    return { allowed: false, reason: "asset url is empty or exceeds the length cap" };

  // T2 — bounded inline raster. No host, no network ; skip T1.
  if (ALLOWED_DATA_IMAGE_RE.test(url)) return { allowed: true };
  // Any other `data:` (text/html/svg/wildcard) is hostile or unbounded.
  if (/^data:/i.test(url))
    return { allowed: false, reason: "data: url is not a bounded image/* payload" };

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // Malformed, relative, or protocol-relative (`//host`) URLs land here.
    return { allowed: false, reason: "asset url is malformed or not absolute" };
  }

  // T2 — scheme allowlist. `new URL().protocol` is lowercased and ends in `:`.
  if (parsed.protocol !== "https:")
    return { allowed: false, reason: "asset url scheme is not https:" };

  // T2 belt-and-braces — userinfo (`https://trusted.com@evil.com`) parses with
  // hostname `evil.com`, which T1 already catches ; we additionally reject any
  // embedded credentials outright so the check is unambiguous.
  if (parsed.username !== "" || parsed.password !== "")
    return { allowed: false, reason: "asset url carries embedded credentials" };

  // T1 — exact host match against the allowlist (deny-by-default).
  if (!allowedHosts || allowedHosts.length === 0)
    return { allowed: false, reason: "no allowedHosts configured ; remote host denied by default" };

  const host = parsed.hostname.toLowerCase();
  for (const entry of allowedHosts) {
    if (typeof entry === "string" && entry.toLowerCase() === host) return { allowed: true };
  }
  return { allowed: false, reason: "asset host is not in assets.allowedHosts" };
}

/**
 * Boolean form of {@link checkHostAllowed}. `true` iff the URL passes both the
 * scheme allowlist (T2) and the host allowlist (T1). Deny-by-default.
 */
export function isHostAllowed(url: unknown, allowedHosts: readonly string[] | undefined): boolean {
  return checkHostAllowed(url, allowedHosts).allowed;
}
