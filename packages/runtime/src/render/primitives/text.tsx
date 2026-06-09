import { motion } from "framer-motion";
import type { PrimitiveProps } from "./index";
import { toFramer, mountPlay } from "../../animate/transitions";

/** Text leaf. Value renders as the displayed string ; style props
 *  cover size / weight / colour / alignment. Opacity is animated when
 *  a transition is declared on `opacity` or `value`. An `animate.from`
 *  makes it mount-play (initial → target) on mount. */
export function Text({ resolved, transitionFor, animateInitial }: PrimitiveProps) {
  const value = resolved.value === undefined ? "" : String(resolved.value);
  const size = (resolved.size as string | number | undefined) ?? "1rem";
  const font = resolved.font as string | undefined;
  const weight = (resolved.weight as number | undefined) ?? 400;
  const colour = (resolved.colour as string | undefined) ?? "currentColor";
  const align = (resolved.align as string | undefined) ?? "start";
  const opacity = numberOr(resolved.opacity, 1);

  const tx = transitionFor("opacity") ?? transitionFor("value");
  const play = mountPlay({ opacity }, animateInitial);

  return (
    <motion.span
      style={{
        display: "inline-block",
        fontSize: size,
        // `font` carries LSML text.style.fontFamily (spec'd in schema.json).
        // Omitted => inherit the host/container font.
        ...(font !== undefined ? { fontFamily: font } : {}),
        fontWeight: weight,
        color: colour,
        textAlign: align as React.CSSProperties["textAlign"],
        willChange: "opacity, transform",
      }}
      initial={play.initial}
      animate={play.animate}
      transition={toFramer(tx)}
    >
      {value}
    </motion.span>
  );
}

function numberOr(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
