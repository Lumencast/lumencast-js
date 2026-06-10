import { motion } from "framer-motion";
import type { ReactElement } from "react";
import type { PrimitiveProps } from "./index";
import { toFramer, mountPlay, resolveTransition } from "../../animate/transitions";
import { parseFills, renderFill } from "../fill";

interface StrokeSpec {
  color?: string;
  width?: number;
}

/** Rectangle / circle / line. Renders as SVG so stroke + fill behave
 *  predictably across hosts. Opacity animatable.
 *
 *  LSML 1.1 §4.6 + §4.12 add `fills[]` / `strokes[]` arrays as the
 *  preferred way to declare multi-layer fills with linear/radial
 *  gradients. The legacy single `fill` / `stroke` props remain
 *  accepted for 1.0 bundles ; when both are present the array form
 *  wins (the spec forbids mixing, but we tolerate to ease migration).
 */
export function Shape({ resolved, transitionFor, animateInitial }: PrimitiveProps) {
  // Canonical prop name is `geometry` (LSML §4.6 — what the compiler
  // emits) ; `kind` is kept as a fallback for hand-rolled Solar-lineage
  // RenderNodes that predate the compiler.
  const kind =
    (resolved.geometry as string | undefined) ?? (resolved.kind as string | undefined) ?? "rect";
  const legacyFill = (resolved.fill as string | undefined) ?? "transparent";
  const legacyStroke = (resolved.stroke as string | undefined) ?? "transparent";
  const legacyStrokeWidth = numberOr(resolved.stroke_width, 0);
  const width = numberOr(resolved.width, 100);
  const height = numberOr(resolved.height, 100);
  const radius = numberOr(resolved.radius, 0);
  const opacity = numberOr(resolved.opacity, 1);

  const tx = resolveTransition(transitionFor, ["opacity"], animateInitial);
  const transition = toFramer(tx);
  const play = mountPlay({ opacity }, animateInitial);

  // LSML 1.1 §4.6 — `fills[]` is the preferred multi-fill form. Fall
  // back to the singular `fill` for 1.0 bundles.
  const fills = parseFills(resolved.fills);
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
      ? strokes.map((s) => ({ color: s.color ?? "transparent", width: s.width ?? 0 }))
      : [{ color: legacyStroke, width: legacyStrokeWidth }];

  // Stack order : fillRefs are emitted top-to-bottom per §4.12. SVG
  // paints later siblings on top, so we reverse here so the first
  // entry in fills[] ends up rendered last (visually on top).
  const stackedFills = [...fillRefs].reverse();
  const stackedStrokes = [...strokeLayers].reverse();

  const renderShape = (
    fill: string,
    stroke: { color: string; width: number },
    keyPrefix: string,
  ): ReactElement => {
    if (kind === "circle") {
      return (
        <circle
          key={keyPrefix}
          cx={width / 2}
          cy={height / 2}
          r={Math.min(width, height) / 2 - stroke.width / 2}
          fill={fill}
          stroke={stroke.color}
          strokeWidth={stroke.width}
        />
      );
    }
    if (kind === "line") {
      return (
        <line
          key={keyPrefix}
          x1="0"
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke={stroke.color || fill}
          strokeWidth={stroke.width || 1}
        />
      );
    }
    // rect default
    return (
      <rect
        key={keyPrefix}
        x={stroke.width / 2}
        y={stroke.width / 2}
        width={Math.max(0, width - stroke.width)}
        height={Math.max(0, height - stroke.width)}
        rx={radius}
        ry={radius}
        fill={fill}
        stroke={stroke.color}
        strokeWidth={stroke.width}
      />
    );
  };

  return (
    <motion.svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      initial={play.initial}
      animate={play.animate}
      transition={transition}
      style={{ willChange: "opacity, transform" }}
    >
      {allDefs.length > 0 && <defs>{allDefs}</defs>}
      {stackedFills.map((ref, i) =>
        renderShape(ref, { color: "transparent", width: 0 }, `fill-${i}`),
      )}
      {stackedStrokes.map((s, i) => renderShape("none", s, `stroke-${i}`))}
    </motion.svg>
  );
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
