// Typed mask builder (LSML 1.2 §4.x, ADR 002 §3.2 #E ; Bastion T1/T2/T3/T4).
//
// A node may carry a typed `mask` whose fields are ALL typed — there is
// deliberately NO free-form SVG string anywhere in the shape. This module
// turns those fields into a real `<mask>` / `<clipPath>` SVG element built
// element-by-element with React, and a CSS reference (`mask`/`clip-path`)
// the Tree applies to the masked subtree's wrapper.
//
// ── Security contract ────────────────────────────────────────────────
//  - T3 — zero arbitrary SVG markup from the bundle. Every node of the
//    `<mask>` is constructed here from typed fields ; no raw-HTML injection
//    React escape hatch is ever used on this path, so `<script>` /
//    `<foreignObject>` / event-handlers are structurally impossible to emit —
//    a `mask.source` that tries to smuggle markup is treated as a plain string
//    and lands on a `<use href>` / `<image href>` value or is rejected
//    outright, never parsed as markup.
//  - T4 — `mask.type` / `mask.op` are RE-VALIDATED against the closed runtime
//    enum (defence in depth ; the compiler already gated them, but live LSDP
//    deltas bypass the compiler). Out-of-enum → diagnostic + the mask is
//    omitted, never passthrough.
//  - T1/T2 — an image `mask.source` URL passes `checkHostAllowed(src,
//    allowedHosts)` BEFORE it reaches the `<image href>` ; rejection → a
//    diagnostic carrying only a STATIC reason (never the URL, R9) and the
//    whole mask is omitted.
//
// The builder is pure : given the typed mask + allowedHosts it returns either
// `null` (omit — render the subtree unmasked) or a `{ def, style }` pair. It
// NEVER throws and NEVER echoes a rejected value.

import type { ReactElement, CSSProperties } from "react";
import { checkHostAllowed } from "@lumencast/protocol";
import { emitDiagnostic } from "./diagnostics";

/** Resolve a shape `mask.source.ref` to its inlined mask-coverage geometry
 *  (#K). The Tree supplies this from its one-pass `id → shape` index ; it
 *  returns `null` for a PENDING ref (id absent from the index) so the mask is
 *  omitted, never crashing. The resolver inlines ONLY the referenced shape's
 *  geometry — never its own mask (anti-cycle, profondeur = 1). */
export type ShapeRefResolver = (ref: string) => ReactElement | null;

/** Closed `mask.type` allowlist — runtime half of the double-gate (T4).
 *  Mirrors `@lumencast/compiler` `MASK_TYPES` ; kept local so the runtime
 *  has no compile-time dependency on the compiler package. */
const MASK_TYPES = new Set(["alpha", "luminance"]);

/** Feather pad (px). The group/shape mask wrapper's `overflow:hidden` box is
 *  grown by this on every side (tree.tsx, `inset:-PAD`) and the coverage is
 *  shifted back by the same amount (buildMask) so a BLURRED mask rim isn't
 *  re-cut into a hard square at the box edge. Generous enough for the
 *  bg-texture ellipse's ~3σ (53.88 CSS sigma) feather. Sharp masks are
 *  unaffected (their alpha-0 region simply sits inside the grown box). */
export const MASK_FEATHER_PAD = 180;

/** Closed `mask.op` allowlist — runtime half of the double-gate (T4). */
const MASK_OPS = new Set(["intersect", "subtract", "union"]);

/** A typed mask source, the only shapes the builder accepts. Anything else
 *  (string, missing discriminant, extra markup) is rejected. A `group` source
 *  (#O) references a GROUP/FRAME container by id, composited downstream. */
export type MaskSource =
  | { kind: "shape"; ref: string }
  | { kind: "image"; src: string; srcRect?: { x: number; y: number; w: number; h: number } }
  | { kind: "group"; ref: string };

/** The typed mask spec as it reaches the runtime (compiler-lowered or a live
 *  LSDP delta). All fields are re-validated here — nothing is trusted. */
export interface MaskSpec {
  source: MaskSource;
  type: "alpha" | "luminance";
  op: "intersect" | "subtract" | "union";
  position?: { x: number; y: number };
  size?: { w: number; h: number };
}

/** What a successfully-built mask contributes to the render. */
export interface BuiltMask {
  /** The `<mask>` element to drop into the masked element's SVG `<defs>`. */
  def: ReactElement;
  /** Inline style applying the mask to the masked subtree's wrapper. */
  style: CSSProperties;
  /** The generated mask id (for `url(#…)` wiring and test assertions). */
  id: string;
  /** True when the coverage is FEATHERED (a blurred edge) : the masked wrapper
   *  must grow by MASK_FEATHER_PAD (tree.tsx) so the soft rim isn't re-cut into a
   *  square, and the coverage here is pre-shifted by the same pad. A sharp mask
   *  leaves this false and skips the pad entirely (no structural change). */
  feather: boolean;
}

let maskIdSeq = 0;
function nextMaskId(): string {
  maskIdSeq = (maskIdSeq + 1) % 1_000_000;
  return `lumen-mask-${maskIdSeq.toString(36)}`;
}

/** Sanitise a shape `ref` to a safe SVG id token. A legitimate ref is a
 *  compiler-assigned node id (`[A-Za-z0-9_:-]`). Anything carrying markup
 *  characters (`<`, `"`, `#`, whitespace, `(`) is rejected — it can only be
 *  an injection attempt, and there is no legitimate id that needs them. */
function safeIdRef(ref: string): string | null {
  return /^[A-Za-z0-9_:-]+$/.test(ref) ? ref : null;
}

function finite(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Validate a loose `mask` value into a strict {@link MaskSpec}, or `null`.
 * Re-runs the closed-enum gates (T4) and the source-shape discriminant ;
 * a malformed mask is dropped whole (it cannot be partially honoured).
 */
export function parseMaskSpec(value: unknown, nodeId: string | undefined): MaskSpec | null {
  if (typeof value !== "object" || value === null) return null;
  const m = value as Record<string, unknown>;

  if (typeof m.type !== "string" || !MASK_TYPES.has(m.type)) {
    emitDiagnostic(nodeId, "mask.type", "is not alpha|luminance ; mask omitted (ADR 002 §3.2, T4)");
    return null;
  }
  if (typeof m.op !== "string" || !MASK_OPS.has(m.op)) {
    emitDiagnostic(
      nodeId,
      "mask.op",
      "is not intersect|subtract|union ; mask omitted (ADR 002 §3.2, T4)",
    );
    return null;
  }

  const src = m.source;
  if (typeof src !== "object" || src === null) {
    emitDiagnostic(nodeId, "mask.source", "is not a typed shape|image source ; mask omitted (T3)");
    return null;
  }
  const s = src as Record<string, unknown>;
  let source: MaskSource;
  if (s.kind === "shape" && typeof s.ref === "string") {
    source = { kind: "shape", ref: s.ref };
  } else if (s.kind === "image" && typeof s.src === "string") {
    // Preserve the mask source's box (`srcRect`: offset from THIS node + size)
    // when present — it places/sizes the CSS mask to the source raster, shared
    // across siblings of different boxes (the caramel halo + drift fix).
    const sr = s.srcRect as { x?: unknown; y?: unknown; w?: unknown; h?: unknown } | undefined;
    source =
      sr && finite(sr.x) && finite(sr.y) && finite(sr.w) && finite(sr.h)
        ? { kind: "image", src: s.src, srcRect: { x: sr.x, y: sr.y, w: sr.w, h: sr.h } }
        : { kind: "image", src: s.src };
  } else if (s.kind === "group" && typeof s.ref === "string") {
    source = { kind: "group", ref: s.ref };
  } else {
    emitDiagnostic(
      nodeId,
      "mask.source",
      "is not a typed shape|image|group source ; mask omitted (T3)",
    );
    return null;
  }

  const spec: MaskSpec = { source, type: m.type as MaskSpec["type"], op: m.op as MaskSpec["op"] };

  const pos = m.position as { x?: unknown; y?: unknown } | undefined;
  if (pos && finite(pos.x) && finite(pos.y)) spec.position = { x: pos.x, y: pos.y };

  const size = m.size as { w?: unknown; h?: unknown } | undefined;
  if (size && finite(size.w) && finite(size.h)) spec.size = { w: size.w, h: size.h };

  return spec;
}

/**
 * Build a `<mask>` element + the CSS reference from a typed mask spec.
 * Returns `null` when the mask must be omitted (bad enum, rejected host,
 * unsafe ref) — the caller renders the subtree unmasked.
 *
 * @param mask          the typed spec (already enum-checked by parseMaskSpec,
 *                      but re-checked here so the builder is safe standalone).
 * @param allowedHosts  the bundle's `assets.allowedHosts` ; an image source is
 *                      gated against it (T1/T2) before reaching `<image href>`.
 * @param nodeId        for diagnostics (never carries a value, R9).
 * @param resolveShape  resolves a shape `mask.source.ref` to its inlined
 *                      coverage geometry (#K). Omitted / returns `null` ⇒ the
 *                      shape source is pending → the whole mask is omitted.
 */
export function buildMask(
  mask: MaskSpec,
  allowedHosts: readonly string[] | undefined,
  nodeId: string | undefined,
  resolveShape?: ShapeRefResolver,
  boxSize?: { w?: number; h?: number },
  feather = false,
): BuiltMask | null {
  // T4 — defence in depth : re-validate the enums even though parseMaskSpec
  // already did, so `buildMask` is safe to call on any typed input.
  if (!MASK_TYPES.has(mask.type) || !MASK_OPS.has(mask.op)) {
    emitDiagnostic(nodeId, "mask", "type/op outside the closed enum ; mask omitted (T4)");
    return null;
  }

  const id = nextMaskId();

  // The mask content : a single element painted into the mask's luminance
  // (or alpha) channel. Coordinates come from typed numbers only.
  const x = mask.position?.x;
  const y = mask.position?.y;
  const w = mask.size?.w;
  const h = mask.size?.h;
  const geom = {
    ...(finite(x) ? { x } : {}),
    ...(finite(y) ? { y } : {}),
    ...(finite(w) ? { width: w } : {}),
    ...(finite(h) ? { height: h } : {}),
  };

  let content: ReactElement;
  if (mask.source.kind === "image") {
    // T1/T2 — gate the URL BEFORE it reaches the `<image href>`. A rejected
    // host/scheme omits the whole mask with a static-reason diagnostic.
    const decision = checkHostAllowed(mask.source.src, allowedHosts);
    if (!decision.allowed) {
      emitDiagnostic(
        nodeId,
        "mask.source.src",
        `image host/scheme rejected ; mask omitted (T1/T2 — ${decision.reason ?? "denied"})`,
      );
      return null;
    }
    // `href` is a typed attribute on a constructed element — never markup.
    // For an alpha mask, read the source's own alpha (mask-type:alpha on the
    // <mask>) ; luminance is the SVG default. The image fills the masked box
    // when no explicit geometry is given.
    // External <image> in an SVG <mask> (0×0 SVG) never loads. For `intersect`
    // apply the raster directly as a CSS mask-image. The masked image content is
    // drawn with `object-fit: cover` (Figma scaleMode FILL), so the mask raster
    // — the SAME source image — must `cover` too, else a `Wpx Hpx` (stretch)
    // mask clips a differently-scaled crop and the caramel ribbon shrinks /
    // shifts off its wave. `cover` keeps the alpha aligned with the content.
    if (mask.op === "intersect") {
      const mode = mask.type === "alpha" ? "alpha" : "luminance";
      const url = `url("${mask.source.src}")`;
      // Place + size the mask to the SOURCE raster's box (`srcRect`: offset from
      // this node's box top-left + size), shared by every masked sibling — NOT
      // `cover` of each sibling's box (inflates → orange halo) nor centred
      // (drifts → mask pulled down). The caramel gradient (1146) and 3d-render
      // (930) thus clip to the SAME wave at the SAME spot.
      const rect = (
        mask.source as { srcRect?: { x: number; y: number; w: number; h: number } }
      ).srcRect;
      const usable = rect && finite(rect.x) && finite(rect.y) && finite(rect.w) && finite(rect.h);
      const sizeCss = usable ? `${rect!.w}px ${rect!.h}px` : "cover";
      const posCss = usable ? `${rect!.x}px ${rect!.y}px` : "center";
      return {
        def: <defs key={id} />,
        style: {
          maskImage: url,
          WebkitMaskImage: url,
          maskSize: sizeCss,
          WebkitMaskSize: sizeCss,
          maskRepeat: "no-repeat",
          WebkitMaskRepeat: "no-repeat",
          maskPosition: posCss,
          WebkitMaskPosition: posCss,
          maskMode: mode,
        } as CSSProperties,
        id,
        feather: false,
      };
    }
    const imgGeom =
      Object.keys(geom).length > 0
        ? geom
        : finite(boxSize?.w) && finite(boxSize?.h)
          ? { x: 0, y: 0, width: boxSize.w, height: boxSize.h }
          : { width: "100%", height: "100%" };
    content = <image href={mask.source.src} preserveAspectRatio="none" {...imgGeom} />;
  } else {
    // Shape (#K) or group/frame (#O) source — INLINE the referenced node's
    // resolved coverage geometry into the `<mask>`, built element-by-element
    // (T3 : zero markup). For a `shape` the resolver returns its own outline ;
    // for a `group` it returns the composite of the container's visible
    // children (the resolver routes on the referenced node's kind).
    //
    // The ref is first re-sanitised (defence in depth : a live LSDP delta could
    // smuggle markup chars), then resolved against the Tree's referenceable-node
    // index. A PENDING ref (id absent) → the mask is omitted, sub-tree rendered
    // unmasked (A2.1 : omission, not crash). Anti-cycle is enforced by the
    // resolver inlining ONLY geometry — never any node's own mask.
    const safeRef = safeIdRef(mask.source.ref);
    if (safeRef === null) {
      emitDiagnostic(
        nodeId,
        "mask.source.ref",
        "shape ref is not a safe id token ; mask omitted (T3)",
      );
      return null;
    }
    const resolved = resolveShape?.(safeRef) ?? null;
    if (resolved === null) {
      emitDiagnostic(
        nodeId,
        "mask.source.ref",
        "shape ref does not resolve to an indexed shape ; mask omitted (ADR 002 A2.1 #K)",
      );
      return null;
    }
    // Position/size place the inlined geometry numerically when given,
    // wrapping it in a translated group (typed numbers only, never a string).
    content =
      Object.keys(geom).length > 0 ? (
        <g
          transform={
            finite(geom.x) || finite(geom.y)
              ? `translate(${finite(geom.x) ? geom.x : 0} ${finite(geom.y) ? geom.y : 0})`
              : undefined
          }
        >
          {resolved}
        </g>
      ) : (
        resolved
      );
  }

  // Feather pad : the mask wrapper's box is grown by MASK_FEATHER_PAD on every
  // side (tree.tsx, `inset:-PAD`) so a BLURRED coverage edge isn't re-cut into a
  // hard square by the wrapper's `overflow:hidden`. The coverage is shifted back
  // by the SAME amount here (userSpaceOnUse), so the mask stays put while the box
  // grows. A sharp mask is unaffected (its alpha-0 region just sits inside the
  // grown box). Applied to the coverage only — never the full-coverage union/
  // subtract rect, which must keep spanning the whole (grown) box.
  if (feather) {
    content = (
      <g key="feather-pad" transform={`translate(${MASK_FEATHER_PAD} ${MASK_FEATHER_PAD})`}>
        {content}
      </g>
    );
  }

  // `union` widens coverage : a base full-coverage white rect is unioned with
  // the source paint. `subtract` removes the source area from full coverage by
  // painting the source black over a white base. `intersect` (default) keeps
  // only the source's own coverage. All three are expressed by which fixed
  // elements we emit — never by interpolating an author string.
  let inner: ReactElement;
  if (mask.op === "intersect") {
    inner = content;
  } else if (mask.op === "union") {
    inner = (
      <>
        <rect x={0} y={0} width="100%" height="100%" fill="white" />
        {content}
      </>
    );
  } else {
    // subtract : white base, source painted black to carve it out.
    inner = (
      <>
        <rect x={0} y={0} width="100%" height="100%" fill="white" />
        <g style={{ filter: "invert(1)" }}>{content}</g>
      </>
    );
  }

  const def = (
    <mask
      id={id}
      key={id}
      // `maskContentUnits` (not `maskUnits`) places the coverage in the masked
      // element's user space. The mask REGION is widened to −50%..150% of the
      // masked box (objectBoundingBox units) so a FEATHERED coverage (the
      // bg-texture ellipse blurred 107.76) keeps its soft rim — the default
      // −10%..120% clipped the blur to a hard SQUARE edge. (The prior
      // `maskUnits="userSpaceOnUse"` WITHOUT x/y/width/height shrank the region
      // to the 0×0 defs-svg viewport, hiding every group/shape-masked subtree —
      // the platform-wide bug ; an explicit region is the robust form.)
      maskContentUnits="userSpaceOnUse"
      x="-50%"
      y="-50%"
      width="200%"
      height="200%"
      // T4 — alpha vs luminance is a typed switch (closed enum, never author
      // text ; kebab key so `mask-type` is emitted verbatim across React).
      {...(mask.type === "alpha" && mask.source.kind !== "image"
        ? { "mask-type": "alpha" }
        : {})}
    >
      {inner}
    </mask>
  );

  const ref = `url(#${id})`;
  return { def, style: { mask: ref, WebkitMask: ref }, id, feather };
}
