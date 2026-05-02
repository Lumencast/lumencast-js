import { motion } from "framer-motion";
import type { PrimitiveProps } from "./index";
import { toFramer } from "../../animate/transitions";

/** Rectangle / circle / line. Renders as SVG so stroke + fill behave
 *  predictably across hosts. Opacity animatable. */
export function Shape({ resolved, transitionFor }: PrimitiveProps) {
  const kind = (resolved.kind as string | undefined) ?? "rect";
  const fill = (resolved.fill as string | undefined) ?? "transparent";
  const stroke = (resolved.stroke as string | undefined) ?? "transparent";
  const strokeWidth = numberOr(resolved.stroke_width, 0);
  const width = numberOr(resolved.width, 100);
  const height = numberOr(resolved.height, 100);
  const radius = numberOr(resolved.radius, 0);
  const opacity = numberOr(resolved.opacity, 1);

  const tx = transitionFor("opacity");
  const transition = toFramer(tx);

  if (kind === "circle") {
    return (
      <motion.svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        animate={{ opacity }}
        transition={transition}
        style={{ willChange: "opacity" }}
      >
        <circle
          cx={width / 2}
          cy={height / 2}
          r={Math.min(width, height) / 2 - strokeWidth / 2}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
      </motion.svg>
    );
  }
  if (kind === "line") {
    return (
      <motion.svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        animate={{ opacity }}
        transition={transition}
        style={{ willChange: "opacity" }}
      >
        <line
          x1="0"
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke={stroke || fill}
          strokeWidth={strokeWidth || 1}
        />
      </motion.svg>
    );
  }
  // Default : rectangle.
  return (
    <motion.svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      animate={{ opacity }}
      transition={transition}
      style={{ willChange: "opacity" }}
    >
      <rect
        x={strokeWidth / 2}
        y={strokeWidth / 2}
        width={Math.max(0, width - strokeWidth)}
        height={Math.max(0, height - strokeWidth)}
        rx={radius}
        ry={radius}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
      />
    </motion.svg>
  );
}

function numberOr(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
