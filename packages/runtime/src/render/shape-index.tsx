// Render-side shape index (ADR 002 §3.2 Amendment 2 / A2.1 #K).
//
// A `mask.source.kind:"shape"` references a shape primitive by its stable `id`
// (mapper-assigned `fig-<safeIdRef(figmaNodeId)>`, see lumencast-figma). At
// render time the `<mask>` must INLINE the referenced shape's resolved geometry
// (the former `<use href="#id">` relied on a defs-resolvable sibling that does
// not exist in the runtime's flat tree). This module builds, in ONE pass over
// the bundle root, an index `id → RenderNode` of every referenceable shape, and
// threads it to the Tree via a plain React context (the bundle is immutable and
// content-addressed, so a mount-stable context is the right tool).
//
// ── Invariants (A2.1 / A4.3) ─────────────────────────────────────────
//  - A `kind:"shape"` node carrying an `id` (shape-source target, #K) OR a
//    `kind:"frame"` node carrying an `id` (group/frame-source target, #O —
//    a GROUP and a FRAME container both lower to `frame`) is indexed. The
//    mapper only emits `id` on actually-referenced nodes (no inflation).
//  - Uniqueness : two nodes claiming the same `id` is a build-time defect. The
//    FIRST occurrence wins and a diagnostic is emitted for each collision
//    (never the id value beyond the field tag — R9-clean field only).
//  - The index is read-only ; resolution is a pure in-memory lookup (A2.4 : no
//    new surface, no URL, no fetch).

import { createContext, useContext, type ReactNode } from "react";
import type { RenderNode } from "./bundle";
import { emitDiagnostic } from "./diagnostics";

export type ShapeIndex = ReadonlyMap<string, RenderNode>;

const EMPTY: ShapeIndex = new Map();
const ShapeIndexCtx = createContext<ShapeIndex>(EMPTY);

/**
 * Walk the bundle tree once and index every referenceable node — a
 * `kind:"shape"` (shape-source, #K) or a `kind:"frame"` (group/frame-source,
 * #O) — that carries an `id`. Collisions keep the first occurrence and
 * diagnose the rest.
 *
 * The walk descends `children` only (the render tree's structural edges) ; it
 * never reads `node.mask`, so building the index can never trigger mask
 * resolution (anti-cycle is enforced at the builder, but the index walk is
 * independent of masks entirely).
 */
export function buildShapeIndex(root: RenderNode | undefined): ShapeIndex {
  if (!root) return EMPTY;
  const index = new Map<string, RenderNode>();
  const stack: RenderNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop() as RenderNode;
    const referenceable = node.kind === "shape" || node.kind === "frame";
    if (referenceable && typeof node.id === "string" && node.id.length > 0) {
      if (index.has(node.id)) {
        emitDiagnostic(
          node.id,
          "id",
          "duplicate shape id ; first occurrence kept, later ones ignored (ADR 002 A2.1 #K)",
        );
      } else {
        index.set(node.id, node);
      }
    }
    // Push children in REVERSE so the LIFO stack pops them in document order :
    // "first occurrence wins" on a duplicate id must follow the bundle's order.
    const children = node.children;
    if (children) {
      for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
    }
  }
  return index;
}

/**
 * Provide a prebuilt shape index to the render subtree. Mounted ONCE at the
 * render root by each mode, wrapping `<Tree>`. Accepts the index directly so
 * the (cheap, one-pass) build happens once per bundle rather than per render.
 */
export function ShapeIndexProvider({
  index,
  children,
}: {
  index: ShapeIndex;
  children: ReactNode;
}) {
  return <ShapeIndexCtx.Provider value={index}>{children}</ShapeIndexCtx.Provider>;
}

/** Read the active shape index. Empty map when no provider is mounted (a
 *  pending ref then resolves to "not found" → mask omitted, never a crash). */
export function useShapeIndex(): ShapeIndex {
  return useContext(ShapeIndexCtx);
}
