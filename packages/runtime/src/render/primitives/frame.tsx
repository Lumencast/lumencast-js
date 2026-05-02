import { motion } from "framer-motion";
import type { PrimitiveProps } from "./index";
import { toFramer } from "../../animate/transitions";

/** Absolute-positioned container with size + transform + opacity.
 *  Animatable on `transform` and `opacity` only — width/height/position
 *  changes are intentionally *not* animatable to keep the broadcast
 *  off the layout path. */
export function Frame({ resolved, transitionFor, children }: PrimitiveProps) {
  const x = numberOr(resolved.x, 0);
  const y = numberOr(resolved.y, 0);
  const width = sizeProp(resolved.width);
  const height = sizeProp(resolved.height);
  const opacity = numberOr(resolved.opacity, 1);
  const scale = numberOr(resolved.scale, 1);
  const rotate = numberOr(resolved.rotate, 0);

  // Pick the most expressive declared transition among the animated
  // bindings (transform / opacity). If none, no animation.
  const tx =
    transitionFor("opacity") ??
    transitionFor("scale") ??
    transitionFor("rotate") ??
    transitionFor("x") ??
    transitionFor("y");

  return (
    <motion.div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width,
        height,
        willChange: "transform, opacity",
      }}
      animate={{
        opacity,
        x,
        y,
        scale,
        rotate,
      }}
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
