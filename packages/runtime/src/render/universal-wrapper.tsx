// Universal-props wrapper (LSML 1.1 §5.4).
//
// Every primitive renders inside this wrapper, which applies the four
// universal props uniformly :
//
//   - `visible: false` → display: none (slot collapses in flex layouts)
//   - `opacity` → CSS opacity, multiplicative with whatever animation
//     a primitive may apply via framer-motion (browsers compose them)
//   - `rotation` → CSS transform: rotate(<deg>)
//   - `sizing.x`/`sizing.y` → flex shorthand on the wrapping div, lets
//     a primitive participate in its parent flex layout's auto-sizing
//
// `bindUniversal` is resolved by the Tree renderer before the wrapper
// sees its values, so this component only deals with concrete numbers
// and booleans.

import type { ReactNode, CSSProperties } from "react";

export type SizingMode = "fixed" | "hug" | "fill";

export interface UniversalProps {
  visible?: boolean;
  opacity?: number;
  rotation?: number;
  sizing?: { x?: SizingMode; y?: SizingMode };
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
  children,
}: UniversalWrapperProps) {
  if (visible === false) {
    return null; // slot collapses in flex/grid layouts (§5.4)
  }

  // No-op fast path — when no universal props are set, render children
  // directly. Lets simple bundles avoid an extra DOM node per primitive.
  const hasOpacity = typeof opacity === "number" && opacity !== 1;
  const hasRotation = typeof rotation === "number" && rotation !== 0;
  const hasSizing = sizing?.x !== undefined || sizing?.y !== undefined;
  if (!hasOpacity && !hasRotation && !hasSizing) {
    return <>{children}</>;
  }

  const style: CSSProperties = {};
  if (hasOpacity) style.opacity = opacity;
  if (hasRotation) style.transform = `rotate(${rotation}deg)`;

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
