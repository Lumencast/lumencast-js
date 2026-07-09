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
import { clampFilterChannel } from "./filter-clamp";

export type SizingMode = "fixed" | "hug" | "fill";

export interface UniversalProps {
  visible?: boolean;
  opacity?: number;
  rotation?: number;
  /** Mirror across the local X axis (Figma `scaleY(-1)`, negative-determinant
   *  transform). Composed with `rotation` on the wrapper so image/shape leaves
   *  mirror like frames do — without it the caramel 3d-render rendered as the
   *  un-mirrored wave (blue where Figma is orange). */
  flipY?: boolean;
  /** Figma LAYER_BLUR radius (px) → CSS `filter: blur()`. */
  blur?: number;
  /** Figma BACKGROUND_BLUR radius (px) → CSS `backdrop-filter: blur()`
   *  (ADR 014 Tier B). Blurs what's BEHIND the node, not its own pixels —
   *  needs the node to have some transparency to show any effect. */
  backdropBlur?: number;
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

/** Collapse a {x,y} sizing pair to a single `flex` shorthand. When both axes
 *  agree, that value ; otherwise honour x (horizontal stacks dominate broadcast
 *  boards — the renderer doesn't know the parent's axis here). */
function sizingToFlex(sizing: { x?: SizingMode; y?: SizingMode } | undefined): string | undefined {
  const x = flexFor(sizing?.x);
  const y = flexFor(sizing?.y);
  if (x === y && x !== undefined) return x;
  return x ?? y;
}

export function UniversalWrapper({
  visible,
  opacity,
  rotation,
  flipY,
  blur,
  backdropBlur,
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
  // R8 runtime gate (ADR 014 R2/R8) — a static `blur`/`backdropBlur` can
  // reach here from a live LSDP delta that bypassed the compiler's clamp
  // entirely ; re-validate and re-clamp, never trust the raw prop.
  const clampedBlur = clampFilterChannel("blur", blur);
  const clampedBackdropBlur = clampFilterChannel("backdropBlur", backdropBlur);
  // No-op fast path — when no universal props are set, render children
  // directly. Lets simple bundles avoid an extra DOM node per primitive.
  // A child WITHOUT `position` never enters the absolute branch, so the
  // normal flow (auto-layout) is left exactly as before (ADR 002 §3.1
  // non-regression : RC#2).
  const hasOpacity = typeof opacity === "number" && opacity !== 1;
  const hasRotation = typeof rotation === "number" && rotation !== 0;
  const hasFlipY = flipY === true;
  const hasBlur = clampedBlur !== null && clampedBlur > 0;
  const hasBackdropBlur = clampedBackdropBlur !== null && clampedBackdropBlur > 0;
  const hasSizing = sizing?.x !== undefined || sizing?.y !== undefined;
  const hasPosition = position !== undefined;
  const hasBlendMode = mixBlendMode !== undefined;
  if (
    !hasOpacity &&
    !hasRotation &&
    !hasFlipY &&
    !hasBlur &&
    !hasBackdropBlur &&
    !hasSizing &&
    !hasPosition &&
    !hasBlendMode
  ) {
    return <>{children}</>;
  }

  // Build the transform string (rotation + mirror). `rotate(θ) scaleY(-1)`
  // applies the mirror first (rightmost), then the rotation — matching Figma's
  // `rotate·scaleY(-1)` matrix (the caramel's −114° + mirror).
  let transform: string | undefined;
  if (hasRotation || hasFlipY) {
    const parts: string[] = [];
    if (hasRotation) parts.push(`rotate(${rotation}deg)`);
    if (hasFlipY) parts.push("scaleY(-1)");
    transform = parts.join(" ");
  }
  // Figma LAYER_BLUR → CSS blur (radius ≈ 2× the CSS sigma, measured on 817:3).
  // (A gamma-correct linearRGB blur was tried to close the bg-shine corner's ~23 R
  // deficit vs the Figma PNG ; it measured WORSE — the deficit is in the high-R
  // channel, which is gamma-INVARIANT — and supersampling the render closed that
  // corner anyway. The Chromium(sRGB)≠Figma(linearRGB) blur gap is else irreducible.)
  const filter = hasBlur ? `blur(${clampedBlur / 2}px)` : undefined;
  // Figma BACKGROUND_BLUR → CSS `backdrop-filter`. Blurs whatever composites
  // BEHIND this box, not the box's own pixels — a fully opaque node shows no
  // visible effect (there's no backdrop to blur through). Same halving as
  // `blur` above for consistency, not independently measured.
  const backdropFilterCss = hasBackdropBlur ? `blur(${clampedBackdropBlur / 2}px)` : undefined;

  const sizingFlex = hasSizing ? sizingToFlex(sizing) : undefined;

  // A `mix-blend-mode` composites with the SCENE backdrop only when its element
  // does not also form an isolating group. `transform`, `opacity < 1` and
  // `filter` each force the element into its own group, so the blend would fold
  // over a TRANSPARENT backdrop instead — the caramel hard-light then shows the
  // raw blue wave rather than compositing over the warm gradient, a screen layer
  // silently no-ops. `backdrop-filter` forms its own stacking context the same
  // way, so it joins the split condition. When the node needs BOTH a blend and
  // one of those, SPLIT: the blend (+ absolute placement) lives on the OUTER
  // box, the isolating transform/opacity/filter/backdrop-filter on an INNER
  // box that carries the sized content.
  if (
    hasBlendMode &&
    (hasOpacity || transform !== undefined || filter !== undefined || backdropFilterCss !== undefined)
  ) {
    const outer: CSSProperties = { mixBlendMode: mixBlendMode as CSSProperties["mixBlendMode"] };
    if (hasPosition) {
      outer.position = "absolute";
      outer.left = position.x;
      outer.top = position.y;
    }
    if (sizingFlex !== undefined) outer.flex = sizingFlex;
    const inner: CSSProperties = {};
    if (typeof size?.w === "number") inner.width = size.w;
    if (typeof size?.h === "number") inner.height = size.h;
    if (hasOpacity) inner.opacity = opacity;
    if (transform !== undefined) inner.transform = transform;
    if (filter !== undefined) inner.filter = filter;
    if (backdropFilterCss !== undefined) {
      inner.backdropFilter = backdropFilterCss;
      inner.WebkitBackdropFilter = backdropFilterCss;
    }
    return (
      <div style={outer}>
        <div style={inner}>{children}</div>
      </div>
    );
  }

  const style: CSSProperties = {};
  if (hasOpacity) style.opacity = opacity;
  if (transform !== undefined) style.transform = transform;
  if (filter !== undefined) style.filter = filter;
  if (backdropFilterCss !== undefined) {
    style.backdropFilter = backdropFilterCss;
    style.WebkitBackdropFilter = backdropFilterCss;
  }
  if (hasBlendMode) style.mixBlendMode = mixBlendMode as CSSProperties["mixBlendMode"];
  // ADR 002 §3.1 (D1) — absolute placement relative to the nearest positioned
  // ancestor. `size` (when present) fixes the box ; otherwise it hugs content.
  if (hasPosition) {
    style.position = "absolute";
    style.left = position.x;
    style.top = position.y;
    if (typeof size?.w === "number") style.width = size.w;
    if (typeof size?.h === "number") style.height = size.h;
  }
  if (sizingFlex !== undefined) style.flex = sizingFlex;

  return <div style={style}>{children}</div>;
}
