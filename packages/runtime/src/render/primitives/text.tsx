import { motion } from "framer-motion";
import type { PrimitiveProps } from "./index";
import { toFramer } from "../../animate/transitions";

/** Text leaf. Value renders as the displayed string ; style props
 *  cover size / weight / colour / alignment. Opacity is animated when
 *  a transition is declared on `opacity` or `value`. */
export function Text({ resolved, transitionFor }: PrimitiveProps) {
  const value = resolved.value === undefined ? "" : String(resolved.value);
  const size = (resolved.size as string | number | undefined) ?? "1rem";
  const weight = (resolved.weight as number | undefined) ?? 400;
  const colour = (resolved.colour as string | undefined) ?? "currentColor";
  const align = (resolved.align as string | undefined) ?? "start";
  const opacity = numberOr(resolved.opacity, 1);

  const tx = transitionFor("opacity") ?? transitionFor("value");

  return (
    <motion.span
      style={{
        display: "inline-block",
        fontSize: size,
        fontWeight: weight,
        color: colour,
        textAlign: align as React.CSSProperties["textAlign"],
        willChange: "opacity",
      }}
      animate={{ opacity }}
      transition={toFramer(tx)}
    >
      {value}
    </motion.span>
  );
}

function numberOr(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
