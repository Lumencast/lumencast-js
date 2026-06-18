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

import type { ReactElement } from "react";
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

/** Closed `mask.op` allowlist — runtime half of the double-gate (T4). */
const MASK_OPS = new Set(["intersect", "subtract", "union"]);

/** A typed mask source, the only two shapes the builder accepts. Anything
 *  else (string, missing discriminant, extra markup) is rejected. */
export type MaskSource = { kind: "shape"; ref: string } | { kind: "image"; src: string };

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
  style: { mask: string; WebkitMask: string };
  /** The generated mask id (for `url(#…)` wiring and test assertions). */
  id: string;
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
    source = { kind: "image", src: s.src };
  } else {
    emitDiagnostic(nodeId, "mask.source", "is not a typed shape|image source ; mask omitted (T3)");
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
    content = (
      <image
        href={mask.source.src}
        preserveAspectRatio="none"
        {...(Object.keys(geom).length > 0 ? geom : { width: "100%", height: "100%" })}
      />
    );
  } else {
    // Shape source (#K) — INLINE the referenced shape's resolved coverage
    // geometry into the `<mask>`, built element-by-element (T3 : zero markup).
    // The former `<use href="#id">` relied on a defs-resolvable sibling that
    // does not exist in the runtime's flat tree, so the mask covered nothing.
    //
    // The ref is first re-sanitised (defence in depth : a live LSDP delta could
    // smuggle markup chars), then resolved against the Tree's `id → shape`
    // index. A PENDING ref (id absent) → the mask is omitted, sub-tree rendered
    // unmasked (A2.1 : omission, not crash). Anti-cycle is enforced by the
    // resolver inlining ONLY geometry — never the resolved shape's own mask.
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
      maskUnits="userSpaceOnUse"
      // T4 — alpha vs luminance is a typed switch, not a free attribute. The
      // value comes from the closed enum, never author text. (kebab key so the
      // SVG `mask-type` attribute is emitted verbatim across React versions.)
      {...(mask.type === "alpha" ? { "mask-type": "alpha" } : {})}
    >
      {inner}
    </mask>
  );

  const ref = `url(#${id})`;
  return { def, style: { mask: ref, WebkitMask: ref }, id };
}
