import { motion } from "framer-motion";
import type { CSSProperties } from "react";
import type { PrimitiveProps } from "./index";
import { toFramer, mountPlay } from "../../animate/transitions";
import { backgroundsToCss, parseFills } from "../fill";

/** Absolute-positioned container with size + transform + opacity.
 *  Animatable on `transform` and `opacity` only — width/height/position
 *  changes are intentionally *not* animatable to keep the broadcast
 *  off the layout path.
 *
 *  LSML 1.1 §4.3 + §4.12 add `backgrounds[]` as an alternative to the
 *  legacy `background` (single color). The array form supports stacked
 *  fills with linear / radial gradients ; first entry renders on top.
 */
export function Frame({ resolved, transitionFor, animateInitial, children }: PrimitiveProps) {
  const x = numberOr(resolved.x, 0);
  const y = numberOr(resolved.y, 0);
  const width = sizeProp(resolved.width);
  const height = sizeProp(resolved.height);
  const opacity = numberOr(resolved.opacity, 1);
  const scale = numberOr(resolved.scale, 1);
  const rotate = numberOr(resolved.rotate, 0);

  // 1.0 single-fill prop — used as fallback when 1.1 `backgrounds[]`
  // is empty.
  const legacyBackground = (resolved.background as string | undefined) ?? undefined;
  const backgrounds = parseFills(resolved.backgrounds);

  // Pick the most expressive declared transition among the animated
  // bindings (transform / opacity). If none, no animation.
  const tx =
    transitionFor("opacity") ??
    transitionFor("scale") ??
    transitionFor("rotate") ??
    transitionFor("x") ??
    transitionFor("y");

  const style: CSSProperties = {
    position: "absolute",
    left: 0,
    top: 0,
    width,
    height,
    willChange: "transform, opacity",
  };
  if (backgrounds.length > 0) {
    Object.assign(style, backgroundsToCss(backgrounds));
  } else if (legacyBackground !== undefined) {
    style.background = legacyBackground;
  }

  const play = mountPlay({ opacity, x, y, scale, rotate }, animateInitial);

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

function numberOr(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function sizeProp(v: unknown): number | string | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.length > 0) return v;
  return undefined;
}
