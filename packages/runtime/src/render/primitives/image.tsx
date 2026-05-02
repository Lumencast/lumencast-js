import { motion } from "framer-motion";
import type { PrimitiveProps } from "./index";
import { toFramer } from "../../animate/transitions";

/** Image leaf. `src`, `fit` (cover/contain/fill), `position`,
 *  `opacity`. Opacity is animated when a transition is declared. */
export function Image({ resolved, transitionFor }: PrimitiveProps) {
  const src = resolved.src as string | undefined;
  if (!src) return null;
  const fit = (resolved.fit as string | undefined) ?? "contain";
  const position = (resolved.position as string | undefined) ?? "center";
  const opacity = numberOr(resolved.opacity, 1);

  const tx = transitionFor("opacity") ?? transitionFor("src");

  return (
    <motion.img
      src={src}
      style={{
        objectFit: fit as React.CSSProperties["objectFit"],
        objectPosition: position,
        width: "100%",
        height: "100%",
        willChange: "opacity",
      }}
      animate={{ opacity }}
      transition={toFramer(tx)}
      draggable={false}
    />
  );
}

function numberOr(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
