import { motion } from "framer-motion";
import type { PrimitiveProps } from "./index";
import { toFramer, mountPlay, resolveTransition } from "../../animate/transitions";

/** Image leaf. `src`, `fit` (cover/contain/fill), `position`,
 *  `opacity`. Opacity is animated when a transition is declared. When an
 *  `animate.from` is lowered onto the node, it mounts at that state and
 *  plays to its target on mount (mount-play). */
export function Image({ resolved, nodeId, transitionFor, animateInitial }: PrimitiveProps) {
  const src = resolved.src as string | undefined;
  if (!src) return null;
  // LSML §4.5 `alt` is required and was silently unrendered until
  // issue #34's allowlist audit surfaced it — now forwarded to the DOM.
  const alt = typeof resolved.alt === "string" ? resolved.alt : "";
  const fit = (resolved.fit as string | undefined) ?? "contain";
  const position = (resolved.position as string | undefined) ?? "center";
  const opacity = numberOr(resolved.opacity, 1);
  // `width`/`height` carry LSML image.size (compiler maps size.w/.h → width/height).
  // When present, honour the intrinsic image dimensions; otherwise fill the
  // container (the prior behaviour — a sized parent drives the layout).
  const width = dimOr(resolved.width, "100%");
  const height = dimOr(resolved.height, "100%");

  const tx = resolveTransition(transitionFor, ["opacity", "src"], animateInitial);
  const play = mountPlay({ opacity }, animateInitial, nodeId);

  return (
    <motion.img
      src={src}
      alt={alt}
      style={{
        objectFit: fit as React.CSSProperties["objectFit"],
        objectPosition: position,
        width,
        height,
        willChange: "opacity, transform",
      }}
      initial={play.initial}
      animate={play.animate}
      transition={toFramer(tx)}
      draggable={false}
    />
  );
}

function numberOr(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** A render dimension: a finite number → px, a non-empty string → verbatim
 *  (e.g. "100%"), anything else → the fallback. */
function dimOr(v: unknown, fallback: string): string {
  if (typeof v === "number" && Number.isFinite(v)) return `${v}px`;
  if (typeof v === "string" && v.length > 0) return v;
  return fallback;
}
