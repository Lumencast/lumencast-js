// Asset + font resolution for the zero-loss render harness (ADR 002 #J / RC#10).
//
// The committed 817:3 bundle references its bitmaps as content-addressed paths
// (`assets/<hash>.png|jpg`) bound through `__lit.image.*` defaults, with
// `assets.allowedHosts = []`. A real broadcast host resolves those through its
// asset pipeline; this module plays that host role for the harness in two
// interchangeable modes:
//
//   - SWATCH mode (committed CI fixture): each reference maps to a bounded,
//     per-family solid-colour `data:image/png` so the run is deterministic and
//     bit-stable with NO external bytes. Used by `harness-entry.tsx`.
//   - REAL mode (local measurement run): each `assets/<hash>.ext` reference maps
//     to the actual asset bitmap, supplied as a pre-encoded `data:` URI table.
//     Used by the `.scratch/` real-asset entry to measure true pixel SSIM.
//
// Both modes emit `data:image/*` URIs, which the runtime host-allow gate already
// admits with `allowedHosts: []` (Bastion T6) — so NO gate is bypassed in either
// mode; the resolver only ever substitutes one allowed scheme for another.

/** A table mapping a bundle `src` reference to its resolved `data:` URI.
 *  Keys may be either the full `assets/<hash>.ext` path or a bare `<hash>`. */
export type AssetTable = Readonly<Record<string, string>>;

/** Resolve a single `src` value against a table. Non-string or unmatched values
 *  pass through unchanged. Matches both `assets/<hash>.ext` and bare `<hash>`. */
export function resolveSrc(src: unknown, table: AssetTable): unknown {
  if (typeof src !== "string") return src;
  if (table[src]) return table[src];
  const m = /^assets\/([A-Za-z0-9]+)\.[A-Za-z0-9]+$/.exec(src);
  if (m && table[m[1]]) return table[m[1]];
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
export interface FontFace {
  family: string;
  weight: number | string;
  style?: string;
  /** `url(data:font/woff2;base64,…)` content (the value inside `src:`). */
  src: string;
}

/** Inject `@font-face` rules and block until the faces are loaded, so the very
 *  first painted frame already uses the brand glyphs (no fallback-font flash).
 *  Returns the families that successfully loaded. */
export async function injectFonts(faces: readonly FontFace[]): Promise<string[]> {
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
    } catch (err) {
      console.warn("[harness:font]", f.family, "failed to load:", err);
    }
  }
  return loaded;
}
