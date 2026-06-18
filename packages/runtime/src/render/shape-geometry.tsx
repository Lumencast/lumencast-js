// Typed shape-geometry builder (ADR 002 §3.2 Amendment 2 / A2.1 #K).
//
// A single source of truth for turning a `shape` RenderNode's typed geometry
// props (`geometry`/`kind`, `width`, `height`, `radius`, path `d`) into SVG
// outline elements — built ELEMENT-BY-ELEMENT with React, never from a markup
// string. Two call-sites consume it :
//
//   1. the `shape` primitive, which paints the outline with its fills/strokes ;
//   2. `buildMask` (#K), which inlines the RESOLVED geometry of a referenced
//      shape into a `<mask>` as coverage paint (white) — replacing the former
//      `<use href="#id">` that relied on a sibling being defs-resolvable.
//
// ── Security / structural contract ───────────────────────────────────
//  - T3 — zero arbitrary SVG markup. Every element here is a constructed
//    React node ; no raw-HTML React escape hatch is ever used on this path.
//    A path `d` still flows through `validatePathData` (svg-path.ts).
//  - Anti-cycle (A2.1, Bastion condition) — this builder reads ONLY the
//    node's own geometry props. It never reads `node.mask`, never descends
//    into `node.children`, and never re-enters the mask builder. Resolving a
//    `mask.source.ref` to a shape therefore inlines that shape's geometry and
//    NOTHING else : a `mask → shape (that itself carries a mask) → …` chain is
//    structurally cut at depth 1, so no unbounded recursion / DoS is possible.

import type { CSSProperties, ReactElement } from "react";
import type { RenderNode } from "./bundle";
import { parseShapePaths, type SubPath } from "./svg-path";

/** The geometry kind, read from `geometry` (compiler) or `kind` (legacy). */
function geometryKind(props: Record<string, unknown>): string {
  return (props.geometry as string | undefined) ?? (props.kind as string | undefined) ?? "rect";
}

function numberOr(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/**
 * Build the outline of a `shape` node as SVG elements painted with the given
 * `fill` and `stroke`. Used by the `shape` primitive (per-fill layering) and,
 * with a fixed coverage paint, by the mask builder (#K).
 *
 * Integration #L — `paint.mixBlendMode` carries a per-fill `mix-blend-mode`
 * that has ALREADY been revalidated against the closed enum by `renderFill`
 * (double-gate T4). It is applied as an inline `style` on the painted layer's
 * SVG element. It is `undefined` for stroke passes and ALWAYS `undefined` for
 * mask coverage (`buildMaskCoverageFromShape` never sets it) — a mask is a
 * coverage stencil, never a colour/blend reproduction (#K hypothesis 2). No
 * value other than an enum-validated keyword can reach this style key.
 *
 * `nodeId` is for path-validation diagnostics only (never a value, R9).
 */
export function buildShapeOutline(
  props: Record<string, unknown>,
  paint: { fill: string; stroke?: string; strokeWidth?: number; mixBlendMode?: string },
  nodeId: string | undefined,
  keyPrefix = "geom",
): ReactElement {
  const kind = geometryKind(props);
  const width = numberOr(props.width, 100);
  const height = numberOr(props.height, 100);
  const radius = numberOr(props.radius, 0);
  const stroke = paint.stroke ?? "none";
  const strokeWidth = paint.strokeWidth ?? 0;
  // #L — only an enum-revalidated keyword reaches here ; absent → no style key
  // (layer blends `normal`, rétro-compat). Mask coverage never passes one.
  const style: CSSProperties | undefined =
    paint.mixBlendMode !== undefined
      ? ({ mixBlendMode: paint.mixBlendMode } as CSSProperties)
      : undefined;

  if (kind === "path") {
    const subpaths = parseShapePaths(props, nodeId);
    return (
      <g key={keyPrefix} style={style}>
        {subpaths.map((p: SubPath, i: number) => (
          <path
            key={i}
            d={p.d}
            fillRule={p.fillRule}
            fill={paint.fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
          />
        ))}
      </g>
    );
  }
  if (kind === "circle") {
    return (
      <circle
        key={keyPrefix}
        style={style}
        cx={width / 2}
        cy={height / 2}
        r={Math.min(width, height) / 2 - strokeWidth / 2}
        fill={paint.fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
      />
    );
  }
  if (kind === "line") {
    return (
      <line
        key={keyPrefix}
        style={style}
        x1="0"
        y1={height / 2}
        x2={width}
        y2={height / 2}
        stroke={stroke !== "none" ? stroke : paint.fill}
        strokeWidth={strokeWidth || 1}
      />
    );
  }
  // rect default
  return (
    <rect
      key={keyPrefix}
      style={style}
      x={strokeWidth / 2}
      y={strokeWidth / 2}
      width={Math.max(0, width - strokeWidth)}
      height={Math.max(0, height - strokeWidth)}
      rx={radius}
      ry={radius}
      fill={paint.fill}
      stroke={stroke}
      strokeWidth={strokeWidth}
    />
  );
}

/**
 * Build a referenced shape's geometry as mask COVERAGE paint (#K).
 *
 * Resolves to a white-painted outline (the default mask luminance paint) of
 * the referenced `shape` node — inlined into the `<mask>`. Returns `null` when
 * the node is not a paintable shape (defensive : the index only stores shapes,
 * but a live delta could mutate one), so the caller omits the mask.
 *
 * Anti-cycle : reads only `node.props` geometry — never the node's own `mask`
 * or children (profondeur de résolution = 1, A2.1 invariant).
 */
export function buildMaskCoverageFromShape(
  node: RenderNode,
  nodeId: string | undefined,
): ReactElement | null {
  if (node.kind !== "shape") return null;
  const props = node.props ?? {};
  // White coverage : the SVG mask default paints luminance from white = full
  // coverage. We deliberately ignore the shape's own fills/strokes — a mask is
  // a coverage stencil, not a colour reproduction (A2.1 : inline the geometry).
  return buildShapeOutline(props, { fill: "white" }, nodeId, "mask-cover");
}
