import { motion } from "framer-motion";
import type { ReactElement } from "react";
import type { PrimitiveProps } from "./index";
import { toFramer, mountPlay, resolveTransition } from "../../animate/transitions";
import { parseFills, renderFill, sanitizeFills, gateImageFills } from "../fill";
import { parseCssColor, warnRejectedColor } from "../css-color";
import { useAllowedHosts } from "../allowed-hosts";
import { buildShapeOutline } from "../shape-geometry";

interface StrokeSpec {
  color?: string;
  width?: number;
}

/** Rectangle / circle / line / path. Renders as SVG so stroke + fill
 *  behave predictably across hosts. Opacity animatable.
 *
 *  LSML 1.1 §4.6 + §4.12 add `fills[]` / `strokes[]` arrays as the
 *  preferred way to declare multi-layer fills with linear/radial
 *  gradients. The legacy single `fill` / `stroke` props remain
 *  accepted for 1.0 bundles ; when both are present the array form
 *  wins (the spec forbids mixing, but we tolerate to ease migration).
 *
 *  Security (ADR 001 §6 RC#10 + RC#11, issue #30) : every colour that
 *  reaches an SVG `fill`/`stroke`/`stop-color` attribute goes through
 *  the strict `parseCssColor` gate, and every path `d` goes through
 *  `validatePathData` — at EVERY render, because props are wire-
 *  drivable live via LSDP deltas (`resolveProps`, tree.tsx).
 */
export function Shape({ resolved, nodeId, transitionFor, animateInitial }: PrimitiveProps) {
  // Canonical prop name is `geometry` (LSML §4.6 — what the compiler
  // emits) ; `kind` is kept as a fallback for hand-rolled Solar-lineage
  // RenderNodes that predate the compiler.
  const kind =
    (resolved.geometry as string | undefined) ?? (resolved.kind as string | undefined) ?? "rect";
  const legacyFill = safeColor(resolved.fill, "shape.fill", nodeId) ?? "transparent";
  const legacyStroke = safeColor(resolved.stroke, "shape.stroke", nodeId) ?? "transparent";
  const legacyStrokeWidth = numberOr(resolved.stroke_width, 0);
  const width = numberOr(resolved.width, 100);
  const height = numberOr(resolved.height, 100);
  const opacity = numberOr(resolved.opacity, 1);
  // LSML §4.6 `ariaLabel` was silently unrendered until issue #34's
  // allowlist audit surfaced it — now forwarded as the SVG label.
  const ariaLabel = typeof resolved.ariaLabel === "string" ? resolved.ariaLabel : undefined;

  const tx = resolveTransition(transitionFor, ["opacity"], animateInitial);
  const transition = toFramer(tx);
  const play = mountPlay({ opacity }, animateInitial, nodeId);

  // LSML 1.1 §4.6 — `fills[]` is the preferred multi-fill form. Fall
  // back to the singular `fill` for 1.0 bundles. Colours are strict-
  // validated (a rejected colour drops its layer, with diagnostic).
  // LSML 1.2 §3.2 — image-fill `src` is host/scheme-gated (Bastion T1/T2)
  // BEFORE any URL reaches an SVG <image href>. A rejected image-fill is
  // dropped (no passthrough) with an R9-clean diagnostic. Colour fills go
  // through `sanitizeFills` (RC#11) ; image fills pass it through untouched.
  const allowedHosts = useAllowedHosts();
  const fills = gateImageFills(
    sanitizeFills(parseFills(resolved.fills, "shape.fills", nodeId), "shape.fills", nodeId),
    allowedHosts,
    "shape.fills",
    nodeId,
  );
  const strokes = parseStrokes(resolved.strokes);

  // Each fill compiles to a (defs, ref) pair. We render the shape
  // outline once per fill, layered top-to-bottom (first entry → on
  // top, per §4.12). The defs are aggregated for a single <defs>.
  const fillRenders = fills.map(renderFill);
  const allDefs = fillRenders.flatMap((r) => r.defs);
  const fillRefs = fillRenders.length > 0 ? fillRenders.map((r) => r.ref) : [legacyFill];

  // Strokes : same layered approach, but solid colours only (gradient
  // strokes are out of scope for §4.6 1.1). Each stroke is rendered
  // as an additional pass over the same shape outline.
  const strokeLayers =
    strokes.length > 0
      ? strokes.map((s) => ({
          color: safeColor(s.color, "shape.strokes.color", nodeId) ?? "transparent",
          width: s.width ?? 0,
        }))
      : [{ color: legacyStroke, width: legacyStrokeWidth }];

  // Stack order : fillRefs are emitted top-to-bottom per §4.12. SVG
  // paints later siblings on top, so we reverse here so the first
  // entry in fills[] ends up rendered last (visually on top).
  const stackedFills = [...fillRefs].reverse();
  const stackedStrokes = [...strokeLayers].reverse();
  // For paths, a zero-width / transparent stroke pass would only emit
  // invisible duplicate <path> elements — skip it.
  const effectiveStrokes =
    kind === "path"
      ? stackedStrokes.filter((s) => s.width > 0 && s.color !== "transparent")
      : stackedStrokes;

  // ADR 002 A2.1 (#K) — a single typed outline builder, shared with the mask
  // inliner (`shape-geometry.tsx`), so a referenced shape's mask coverage is
  // built from the IDENTICAL geometry as its on-screen render.
  const renderShape = (
    fill: string,
    stroke: { color: string; width: number },
    keyPrefix: string,
  ): ReactElement =>
    buildShapeOutline(
      resolved,
      { fill, stroke: stroke.color, strokeWidth: stroke.width },
      nodeId,
      keyPrefix,
    );

  return (
    <motion.svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      {...(ariaLabel !== undefined ? { "aria-label": ariaLabel, role: "img" } : {})}
      initial={play.initial}
      animate={play.animate}
      transition={transition}
      style={{ willChange: "opacity, transform" }}
    >
      {allDefs.length > 0 && <defs>{allDefs}</defs>}
      {stackedFills.map((ref, i) =>
        renderShape(ref, { color: "transparent", width: 0 }, `fill-${i}`),
      )}
      {effectiveStrokes.map((s, i) => renderShape("none", s, `stroke-${i}`))}
    </motion.svg>
  );
}

/** Strict-validate a colour prop (RC#11 — SVG attributes are injection
 * sites too once values are wire-drivable). Non-strings resolve to
 * null silently (absent prop) ; a string that fails the strict grammar
 * is rejected with a diagnostic (value withheld per R9). */
function safeColor(value: unknown, field: string, nodeId?: string): string | null {
  if (typeof value !== "string") return null;
  const color = parseCssColor(value);
  if (color === null) warnRejectedColor(field, nodeId);
  return color;
}

function parseStrokes(value: unknown): StrokeSpec[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (v): v is StrokeSpec => typeof v === "object" && v !== null && ("color" in v || "width" in v),
  );
}

function numberOr(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
