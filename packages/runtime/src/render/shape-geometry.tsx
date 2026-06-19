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
import { emitDiagnostic } from "./diagnostics";

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
    // A Figma ELLIPSE node lowers to `circle`, but its box is often NON-square
    // (the bg-shine glows are 699×428, 955×586…). Render an <ellipse> with the
    // per-axis radii so the shape keeps its real size — a circle (w===h) is the
    // degenerate case. Rendering a `min(w,h)` circle shrank the glows → the warm
    // wash came out too dark and the wrong shape.
    return (
      <ellipse
        key={keyPrefix}
        style={style}
        cx={width / 2}
        cy={height / 2}
        rx={Math.max(0, width / 2 - strokeWidth / 2)}
        ry={Math.max(0, height / 2 - strokeWidth / 2)}
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

/** Default cap on the number of direct children composited into a group mask
 *  (A4.4 budget T5). A container with more visible resolvable children is
 *  TRUNCATED at this count with a diagnostic — never an unbounded build. The
 *  real `817:2011` has 4 children ; the cap is generous yet bounded. */
export const GROUP_MASK_MAX_CHILDREN = 64;

/** Default cap on container-descent depth (A4.4 anti-cycle). `1` = a group's
 *  direct children may themselves be one level of sub-container ; below that a
 *  sub-container contributes nothing (diagnostic), so a `group → group → …`
 *  chain can never recurse without bound. We NEVER read a node's own `mask`
 *  during descent (a `mask → group → … → mask` cycle is structurally cut). */
export const GROUP_MASK_MAX_DEPTH = 1;

/** True iff a child node is excluded from the composite (`visible:false`).
 *  `visible` lives in the node's static props (compiler-flattened), mirroring
 *  the Tree's universal extraction (`resolved.visible`). */
function isHidden(node: RenderNode): boolean {
  return (node.props as { visible?: unknown } | undefined)?.visible === false;
}

function numProp(props: Record<string, unknown> | undefined, key: string): number {
  const v = props?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * Composite the mask COVERAGE of a GROUP/FRAME container's VISIBLE children
 * into a single typed `<g>` (#O, ADR 002 A4.3/A4.4).
 *
 * The coverage is the **union** of the white outlines of every visible direct
 * child of geometry-resolvable kind — union being the native behaviour of
 * stacking white coverages in one `<mask>` (SVG alpha cumulates). Each child's
 * geometry is translated by its own `x`/`y` so the union lands in the
 * container's coordinate space.
 *
 * Invariants (A4.4) :
 *  - **visible-only** : `visible:false` children do not contribute.
 *  - **anti-cycle, depth = 1** : a direct child that is itself a container is
 *    descended at most `maxDepth` levels (default 1). We read ONLY geometry —
 *    never any node's own `mask` — so a `mask → group → … → mask` chain is
 *    structurally cut and no recursion through masks is possible.
 *  - **budget T5** : at most `maxChildren` direct children are composited ;
 *    beyond the cap the remainder is dropped with a static-reason diagnostic
 *    (R9 — never the id value), never an unbounded composite / freeze.
 *  - **omission, not crash** : a container with no visible resolvable child
 *    returns `null` so the caller omits the mask (no throw).
 *
 * @param nodeId    for diagnostics only (never a value, R9).
 * @param maxDepth  container-descent cap (default {@link GROUP_MASK_MAX_DEPTH}).
 * @param maxChildren  per-container child cap (default {@link GROUP_MASK_MAX_CHILDREN}).
 */
export function buildMaskCoverageFromGroup(
  node: RenderNode,
  nodeId: string | undefined,
  maxDepth: number = GROUP_MASK_MAX_DEPTH,
  maxChildren: number = GROUP_MASK_MAX_CHILDREN,
): ReactElement | null {
  if (node.kind !== "frame") return null;
  const parts = collectCoverage(node, nodeId, maxDepth, maxChildren, "grp");
  if (parts.length === 0) return null;
  return <g key="mask-group-cover">{parts}</g>;
}

/** True when a group-mask source carries a LAYER_BLUR on any (depth-bounded)
 *  visible geometry child — the FEATHERED case (e.g. the bg-texture ellipse
 *  blurred 107.76) whose soft rim needs the wrapper feather pad (mask.tsx /
 *  tree.tsx). A sharp source returns false so the pad is skipped entirely — no
 *  extra wrapper, no structural change to ordinary masks. Mirrors the blur
 *  detection + descent bounds of `collectCoverage`. */
export function coverageIsFeathered(
  node: RenderNode,
  depth: number = GROUP_MASK_MAX_DEPTH,
): boolean {
  if (node.kind !== "frame") return false;
  for (const child of (node.children ?? []) as RenderNode[]) {
    if (isHidden(child)) continue;
    if (numProp(child.props, "blur") > 0) return true;
    if (child.kind === "frame" && depth > 0 && coverageIsFeathered(child, depth - 1)) return true;
  }
  return false;
}

/** Recursive (depth-bounded) collector : returns the white coverage elements
 *  of `node`'s visible direct children, translating each by its own `x`/`y`.
 *  A child container is descended only while `depth > 0`. NEVER reads a node's
 *  `mask`. */
function collectCoverage(
  node: RenderNode,
  nodeId: string | undefined,
  depth: number,
  maxChildren: number,
  keyPrefix: string,
): ReactElement[] {
  const children = node.children ?? [];
  const out: ReactElement[] = [];
  let composited = 0;
  for (let i = 0; i < children.length; i++) {
    const child = children[i] as RenderNode;
    if (isHidden(child)) continue;
    if (composited >= maxChildren) {
      emitDiagnostic(
        nodeId,
        "mask.source.ref",
        `group mask exceeds the ${maxChildren}-child composite cap ; remainder truncated (ADR 002 A4.4 T5)`,
      );
      break;
    }
    let part: ReactElement | null = null;
    if (child.kind === "shape") {
      part = buildShapeOutline(child.props ?? {}, { fill: "white" }, child.id, `${keyPrefix}-${i}`);
    } else if (child.kind === "frame" && depth > 0) {
      // Bounded container descent (anti-cycle) — geometry only, never `mask`.
      const sub = collectCoverage(child, nodeId, depth - 1, maxChildren, `${keyPrefix}-${i}`);
      if (sub.length > 0) part = <g key={`${keyPrefix}-${i}`}>{sub}</g>;
    }
    // A non-geometry child (text/image/instance) or a too-deep sub-container
    // contributes nothing — the mask is a coverage stencil over geometry only.
    if (part === null) continue;
    // A LAYER_BLUR on the coverage shape FEATHERS the mask edge — the bg-texture
    // mask is a single ellipse blurred 107.76 (radius), so the WP tiles fade out
    // softly instead of being cut by a hard circular edge. Apply it via an SVG
    // `<feGaussianBlur>` (radius ≈ 2× the CSS sigma) with a WIDE filter region :
    // a plain CSS `filter:blur()` on an SVG element clips to the default
    // −10%..120% box, so the feathered ellipse re-appeared with a hard SQUARE
    // edge. The wide region (−120%..340%) lets the soft rim spread unclipped.
    const childBlur = numProp(child.props, "blur");
    if (childBlur > 0) {
      const bf = `lumen-mcov-blur-${nodeId ?? "x"}-${keyPrefix}-${i}`;
      part = (
        <g key={`${keyPrefix}-b-${i}`}>
          <filter id={bf} x="-120%" y="-120%" width="340%" height="340%">
            <feGaussianBlur stdDeviation={childBlur / 2} />
          </filter>
          <g filter={`url(#${bf})`}>{part}</g>
        </g>
      );
    }
    const x = numProp(child.props, "x");
    const y = numProp(child.props, "y");
    out.push(
      x !== 0 || y !== 0 ? (
        <g key={`${keyPrefix}-t-${i}`} transform={`translate(${x} ${y})`}>
          {part}
        </g>
      ) : (
        part
      ),
    );
    composited++;
  }
  return out;
}
