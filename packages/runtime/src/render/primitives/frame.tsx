import { motion } from "framer-motion";
import type { CSSProperties } from "react";
import type { PrimitiveProps } from "./index";
import { toFramer, mountPlay, resolveTransition } from "../../animate/transitions";
import { backgroundsToCss, parseFills, gateImageFills } from "../fill";
import { parseCssColor, warnRejectedColor } from "../css-color";
import { emitDiagnostic } from "../diagnostics";
import { useAllowedHosts } from "../allowed-hosts";

/** Absolute-positioned container with size + transform + opacity.
 *  Animatable on `transform` and `opacity` only — width/height/position
 *  changes are intentionally *not* animatable to keep the broadcast
 *  off the layout path.
 *
 *  LSML 1.1 §4.3 + §4.12 add `backgrounds[]` as an alternative to the
 *  legacy `background` (single color). The array form supports stacked
 *  fills with linear / radial gradients ; first entry renders on top.
 *
 *  LSML 1.1 §4.3 `clipsContent` (default `true`) clips children outside
 *  the frame's bounds via `overflow: hidden` (ADR 001 §3.2.5, RC#5).
 */
export function Frame({
  resolved,
  nodeId,
  transitionFor,
  animateInitial,
  children,
}: PrimitiveProps) {
  const x = numberOr(resolved.x, 0);
  const y = numberOr(resolved.y, 0);
  const width = sizeProp(resolved.width);
  const height = sizeProp(resolved.height);
  const opacity = numberOr(resolved.opacity, 1);
  const scale = numberOr(resolved.scale, 1);
  // Static `rotation` (LSML §5.4) is applied HERE, on the frame's own box, so it
  // pivots around the frame centre (transform-origin: center). It must NOT go on
  // the UniversalWrapper for a frame : the wrapper carries no position/size for
  // a self-positioning frame, so it collapses to a 0-height box and the rotation
  // pivots around the wrong point (the picto/caramel swung off-place). `rotate`
  // (animated) still wins when present.
  const rotate = numberOr(resolved.rotate, numberOr(resolved.rotation, 0));
  // Mirror (Figma `scaleY(-1)`, from a negative transform determinant). Applied
  // on the frame box like the rotation so it composes correctly.
  const flipY = resolved.flipY === true;
  // Compiler forwards `cornerRadius` → `radius` (compile.ts). A frame can be a
  // rounded container (Figma pills, the rounded picto square) — apply it as
  // `border-radius` so the frame isn't rendered square.
  const radius = numberOr(resolved.radius, 0);

  // 1.0 single-fill prop — used as fallback when 1.1 `backgrounds[]`
  // is empty. RC#11 : the value is untrusted (static prop OR live LSDP
  // delta) and lands in inline CSS — strict-parse, never passthrough.
  const rawBackground = resolved.background;
  const legacyBackground = rawBackground === undefined ? undefined : parseCssColor(rawBackground);
  if (rawBackground !== undefined && legacyBackground === null) {
    warnRejectedColor("frame.background", nodeId);
  }
  // LSML 1.2 §3.2 — image-fill `src` is host/scheme-gated (Bastion T1/T2)
  // BEFORE any URL reaches `background-image`. A rejected image-fill is
  // dropped (no passthrough) with an R9-clean diagnostic.
  const allowedHosts = useAllowedHosts();
  const backgrounds = gateImageFills(
    parseFills(resolved.backgrounds, "frame.backgrounds", nodeId),
    allowedHosts,
    "frame.backgrounds",
    nodeId,
  );
  const clipsContent = resolveClipsContent(resolved.clipsContent, nodeId);

  // Pick the most expressive declared transition among the animated
  // bindings (transform / opacity). If none, no animation.
  const tx = resolveTransition(
    transitionFor,
    ["opacity", "scale", "rotate", "x", "y"],
    animateInitial,
  );

  const style: CSSProperties = {
    position: "absolute",
    left: 0,
    top: 0,
    width,
    height,
    // NB: NO permanent `will-change`. `will-change: opacity` makes the frame an
    // isolated group (the browser pre-promotes it as if opacity < 1), which
    // CONTAINS any descendant `mix-blend-mode` to the frame's own backdrop — so
    // a screen/hard-light layer (Sunshine, Ruby20) silently stops compositing
    // with the scene below. The hint also belongs only on actively-animating
    // nodes (bind-animate adds it there) ; a static board doesn't need it.
    // LSML 1.1 §4.3 `clipsContent` (default `true`) — children outside
    // the frame's `size` are clipped. Static layout property : it never
    // animates, so it stays off the 0-layout-event hot path (ADR 001
    // §3.2.5). `false` => omit the declaration (CSS initial = visible).
    ...(clipsContent ? { overflow: "hidden" } : {}),
    ...(radius > 0 ? { borderRadius: radius } : {}),
  };
  if (backgrounds.length > 0) {
    Object.assign(style, backgroundsToCss(backgrounds, nodeId));
  } else if (legacyBackground !== undefined && legacyBackground !== null) {
    style.background = legacyBackground;
  }
  // Figma DROP_SHADOW / INNER_SHADOW. INNER → CSS `box-shadow: inset` (the
  // square's orange/red rim, on the rotated rounded frame, rotates with it in
  // local space — matches Figma). A no-spread DROP → CSS `filter: drop-shadow`,
  // which casts the shadow from the element's RENDERED CONTENT silhouette, not
  // its own rectangular box : the 5 drop shadows live on the UN-rotated wrapper
  // GROUP, so a plain `box-shadow` would project a sharp axis-aligned 464² rect
  // instead of the rotated (8.63°) rounded (r=111) square held inside. The
  // colour is strict-parsed (RC#11) ; geometry is numeric.
  const { filter: shadowFilter, boxShadow } = buildShadows(resolved.shadow, nodeId);
  if (boxShadow !== undefined) style.boxShadow = boxShadow;
  if (shadowFilter !== undefined) style.filter = shadowFilter;

  const play = mountPlay(
    { opacity, x, y, scale, rotate, ...(flipY ? { scaleY: -1 } : {}) },
    animateInitial,
    nodeId,
  );

  return (
    <motion.div
      style={style}
      initial={play.initial}
      animate={play.animate}
      transition={toFramer(tx)}
    >
      {children}
    </motion.div>
  );
}

/**
 * Resolve `clipsContent` (LSML 1.1 §4.3, schema default `true`).
 *
 * The prop is wire-drivable (static bundle prop OR live LSDP delta via
 * `resolveProps`, tree.tsx), so a non-boolean is treated as hostile :
 * R9 diagnostic (value withheld) + fall back to the spec default
 * (`true`, i.e. clipped — the safe state for broadcast). The returned
 * value only ever selects between two literal style fragments — no
 * untrusted value can reach inline CSS through this path (RC#11 by
 * construction). Exported for boundary testing.
 */
export function resolveClipsContent(v: unknown, nodeId?: string): boolean {
  if (v === undefined) return true;
  if (typeof v === "boolean") return v;
  emitDiagnostic(nodeId, "frame.clipsContent", "rejected value : not a boolean");
  return true;
}

function numberOr(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** Build validated shadow CSS from the node's `shadow[]` (each entry:
 *  `{ inset?, color, x, y, blur, spread }`). Every colour goes through the
 *  strict `parseCssColor` gate (RC#11 : the value is wire-drivable) — a
 *  rejected colour drops that layer with a diagnostic, never reaches CSS.
 *  Geometry values are coerced to finite numbers.
 *
 *  Splits by kind :
 *   - INNER (inset) OR any shadow with a non-zero spread → `box-shadow`
 *     (inset rim / spread halo — both follow the element's own border box,
 *     which for the rotated rounded square IS the right silhouette).
 *   - no-spread DROP → `filter: drop-shadow`, cast from the element's rendered
 *     CONTENT (so a wrapper group's drop shadow tracks its rotated/rounded
 *     child instead of the wrapper's rectangular box). drop-shadow's blur maps
 *     to a Gaussian stdDeviation ; box-shadow uses 2×σ, so halve to match.
 *  Returns `{}` when nothing usable survives. */
function buildShadows(
  value: unknown,
  nodeId?: string,
): { filter?: string; boxShadow?: string } {
  if (!Array.isArray(value) || value.length === 0) return {};
  const dropParts: string[] = [];
  const boxParts: string[] = [];
  for (const s of value) {
    if (typeof s !== "object" || s === null) continue;
    const spec = s as {
      inset?: unknown;
      color?: unknown;
      x?: unknown;
      y?: unknown;
      blur?: unknown;
      spread?: unknown;
    };
    const color = typeof spec.color === "string" ? parseCssColor(spec.color) : null;
    if (color === null) {
      warnRejectedColor("frame.shadow.color", nodeId);
      continue;
    }
    const x = numberOr(spec.x, 0);
    const y = numberOr(spec.y, 0);
    const blur = numberOr(spec.blur, 0);
    const spread = numberOr(spec.spread, 0);
    const inset = spec.inset === true;
    if (!inset && spread === 0) {
      dropParts.push(`drop-shadow(${x}px ${y}px ${blur / 2}px ${color})`);
    } else {
      const insetKw = inset ? "inset " : "";
      boxParts.push(`${insetKw}${x}px ${y}px ${blur}px ${spread}px ${color}`);
    }
  }
  const out: { filter?: string; boxShadow?: string } = {};
  if (dropParts.length > 0) out.filter = dropParts.join(" ");
  if (boxParts.length > 0) out.boxShadow = boxParts.join(", ");
  return out;
}

function sizeProp(v: unknown): number | string | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.length > 0) return v;
  return undefined;
}
