// Universal-props wrapper (LSML 1.1 §5.4).
//
// Every primitive renders inside this wrapper, which applies the
// universal props uniformly :
//
//   - `visible: false` → display: none (slot collapses in flex layouts)
//   - `opacity` → CSS opacity, multiplicative with whatever animation
//     a primitive may apply via framer-motion (browsers compose them)
//   - `rotation` → CSS transform: rotate(<deg>)
//   - `sizing.x`/`sizing.y` → flex shorthand on the wrapping div, lets
//     a primitive participate in its parent flex layout's auto-sizing
//   - `position.{x,y}` → absolute placement relative to the nearest
//     positioned ancestor (ADR 002 §3.1 / D1) : a child carrying
//     `position` is taken out of the normal flow and pinned at
//     `left:x; top:y`. A child WITHOUT `position` keeps the normal flow
//     untouched (auto-layout intact) — this is the Figma free-form vs
//     auto-layout duality, honoured at render. `size.{w,h}` fixes the
//     absolute box (the rating square's 24×7 / 14×22 text boxes) ;
//     omitted → hug the content. Position is a static layout property and
//     never animates (it stays off the 0-layout-event broadcast hot path).
//
// `bindUniversal` is resolved by the Tree renderer before the wrapper
// sees its values, so this component only deals with concrete numbers
// and booleans.

import type { ReactNode, CSSProperties } from "react";

import { parseBlendMode } from "./blend-mode";

export type SizingMode = "fixed" | "hug" | "fill";

export interface UniversalProps {
  visible?: boolean;
  opacity?: number;
  rotation?: number;
  sizing?: { x?: SizingMode; y?: SizingMode };
  /** ADR 002 §3.1 (D1) — parent-relative absolute placement. When set,
   *  the wrapper pins the primitive at `left:x; top:y` (position:absolute)
   *  instead of leaving it in the normal flow. Both axes are required
   *  (the Tree only forms this object from a finite `{x,y}` pair). */
  position?: { x: number; y: number };
  /** ADR 002 §3.1 (D1) — the absolute box's fixed size, applied only
   *  alongside `position`. Omitted → the box hugs its content. */
  size?: { w?: number; h?: number };
  /** ADR 002 §3.2 (D2 / #D) — a Figma blend mode → CSS `mix-blend-mode`.
   *  The value is re-validated against the closed enum at render
   *  (`parseBlendMode`, T4 double-gate) ; anything outside the allowlist
   *  is omitted, never written to the style. */
  blendMode?: string;
}

export interface UniversalWrapperProps extends UniversalProps {
  children: ReactNode;
}

/**
 * Maps a SizingMode onto a flex shorthand. Per LSML 1.1 §5.4.1 :
 *   - fixed : the primitive honours its declared size verbatim
 *   - hug   : the primitive shrinks to its intrinsic content size
 *   - fill  : the primitive grows to fill available space
 */
function flexFor(mode: SizingMode | undefined): string | undefined {
  switch (mode) {
    case "fixed":
      return "0 0 auto";
    case "hug":
      return "0 1 auto";
    case "fill":
      return "1 1 auto";
    default:
      return undefined;
  }
}

export function UniversalWrapper({
  visible,
  opacity,
  rotation,
  sizing,
  position,
  size,
  blendMode,
  children,
}: UniversalWrapperProps) {
  if (visible === false) {
    return null; // slot collapses in flex/grid layouts (§5.4)
  }

  // ADR 002 §3.2 (D2 / #D) — re-validate the blend mode against the
  // closed enum at render (T4 runtime gate). A recognised mode yields a
  // CSS `mix-blend-mode` keyword ; anything else is `undefined` and never
  // reaches the style (no free CSS string, no passthrough).
  const mixBlendMode = parseBlendMode(blendMode);

  // No-op fast path — when no universal props are set, render children
  // directly. Lets simple bundles avoid an extra DOM node per primitive.
  // A child WITHOUT `position` never enters the absolute branch, so the
  // normal flow (auto-layout) is left exactly as before (ADR 002 §3.1
  // non-regression : RC#2).
  const hasOpacity = typeof opacity === "number" && opacity !== 1;
  const hasRotation = typeof rotation === "number" && rotation !== 0;
  const hasSizing = sizing?.x !== undefined || sizing?.y !== undefined;
  const hasPosition = position !== undefined;
  const hasBlendMode = mixBlendMode !== undefined;
  if (!hasOpacity && !hasRotation && !hasSizing && !hasPosition && !hasBlendMode) {
    return <>{children}</>;
  }

  const style: CSSProperties = {};
  if (hasOpacity) style.opacity = opacity;
  if (hasRotation) style.transform = `rotate(${rotation}deg)`;
  if (hasBlendMode) style.mixBlendMode = mixBlendMode as CSSProperties["mixBlendMode"];

  // ADR 002 §3.1 (D1) — absolute placement relative to the nearest
  // positioned ancestor. The Tree only forms `position` from a finite
  // `{x,y}` pair, so the two numbers reach inline CSS as plain px with
  // no untrusted-value passthrough. `size` (when present) fixes the box ;
  // otherwise the box hugs its content.
  if (hasPosition) {
    style.position = "absolute";
    style.left = position.x;
    style.top = position.y;
    if (typeof size?.w === "number") style.width = size.w;
    if (typeof size?.h === "number") style.height = size.h;
  }

  // sizing.x / sizing.y map to flex / row-flex behaviour. The
  // x-axis applies along the main axis of a horizontal stack ; the
  // y-axis along a vertical stack. We emit `flex` (covers both via
  // CSS's flex-direction) and rely on the parent stack for orientation.
  if (hasSizing) {
    const x = flexFor(sizing?.x);
    const y = flexFor(sizing?.y);
    // Emit a single flex declaration when both axes agree, otherwise
    // ship explicit grow/shrink/basis based on the dominant intent.
    if (x === y && x !== undefined) {
      style.flex = x;
    } else {
      // Heuristic : honour x for horizontal stacks (most common in
      // broadcast UIs). Renderer doesn't know the parent's axis here ;
      // a future iteration could thread that through context.
      style.flex = x ?? y;
    }
  }

  return <div style={style}>{children}</div>;
}
