// Public asset + font resolution helpers for headless / host render (ADR 003 §3.2).
//
// These utilities let a HOST (Solar headless entry, a ZabCanvas render worker,
// the zero-loss harness) resolve a bundle's content-addressed asset references
// to concrete `data:` URIs and inject brand `@font-face`s BEFORE the first
// frame — exactly as the zero-loss harness has always done (ADR 002 #J). They
// are promoted here verbatim so every host resolves identically and exercises
// the SAME host-allow gate the runtime applies internally.
//
// ── No-fetch contract (ADR 003 §3.2, D3, Bastion R2) ────────────────────────
// NONE of these helpers performs a network fetch. They only rewrite a bundle's
// `src` values against a caller-supplied table (`resolveSrc` /
// `rewriteLayoutSrcs` / `rewriteDefaultsSrcs`) and load `@font-face`s from
// caller-supplied `data:`/same-document URLs (`injectFonts`). The runtime never
// reaches the network; the host owns where bytes come from. Both the input
// table values and the font `src`s are expected to be `data:` (or otherwise
// already host-allowed) URIs — substituting one already-admitted scheme for
// another, so the deny-by-default `allowedHosts` gate stays the sole authority.
// ─────────────────────────────────────────────────────────────────────────────

/** A table mapping a bundle `src` reference to its resolved `data:` URI.
 *  Keys may be either the full `assets/<hash>.ext` path or a bare `<hash>`. */
export type AssetTable = Readonly<Record<string, string>>;

/** Resolve a single `src` value against a table. Non-string or unmatched values
 *  pass through unchanged. Matches both `assets/<hash>.ext` and bare `<hash>`. */
export function resolveSrc(src: unknown, table: AssetTable): unknown {
  if (typeof src !== "string") return src;
  if (table[src]) return table[src];
  const m = /^assets\/([A-Za-z0-9]+)\.[A-Za-z0-9]+$/.exec(src);
  if (m && m[1] !== undefined && table[m[1]]) return table[m[1]];
  return src;
}

/** Deep-rewrite every `src` (image-fill, mask source) in a layout subtree,
 *  in place, against the supplied asset table. */
export function rewriteLayoutSrcs(node: unknown, table: AssetTable): void {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const n of node) rewriteLayoutSrcs(n, table);
    return;
  }
  const obj = node as Record<string, unknown>;
  if ("src" in obj) obj["src"] = resolveSrc(obj["src"], table);
  for (const v of Object.values(obj)) {
    if (v && typeof v === "object") rewriteLayoutSrcs(v, table);
  }
}

/** Rewrite the `__lit.image.*` defaults (image-primitive `bind.src` targets)
 *  against the asset table, returning a new defaults object. */
export function rewriteDefaultsSrcs(
  defaults: Record<string, unknown>,
  table: AssetTable,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...defaults };
  for (const [k, v] of Object.entries(out)) {
    if (k.startsWith("__lit.image.")) out[k] = resolveSrc(v, table);
  }
  return out;
}

/** A brand `@font-face` to inject before render. `src` is a `data:` URI (or any
 *  same-document URL) so no network/host-allow surface is involved. */
export interface FontFaceSpec {
  family: string;
  weight: number | string;
  style?: string;
  /** `url(data:font/woff2;base64,…)` content (the value inside `src:`). */
  src: string;
}

/** Inject `@font-face` rules and block until the faces are loaded, so the very
 *  first painted frame already uses the brand glyphs (no fallback-font flash).
 *  Returns the families that successfully loaded. Loads only from the supplied
 *  `src` (expected `data:`); never fetches a remote host on its own behalf. */
export async function injectFonts(faces: readonly FontFaceSpec[]): Promise<string[]> {
  const loaded: string[] = [];
  for (const f of faces) {
    try {
      const face = new FontFace(f.family, f.src, {
        weight: String(f.weight),
        style: f.style ?? "normal",
      });
      await face.load();
      (document as Document & { fonts: FontFaceSet }).fonts.add(face);
      loaded.push(f.family);
    } catch {
      // A font that fails to load is a documented gap, not a render-breaker:
      // the fallback glyphs paint and the host can detect the missing family
      // in the returned list. Never throw (would abort an otherwise-good
      // render) and never log the value (R9) — the absent family name is in
      // `f.family`, which the caller already holds.
    }
  }
  return loaded;
}
