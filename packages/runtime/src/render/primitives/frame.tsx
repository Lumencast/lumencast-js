import { motion } from "framer-motion";
import type { CSSProperties } from "react";
import type { PrimitiveProps } from "./index";
import { toFramer, mountPlay, resolveTransition } from "../../animate/transitions";
import { backgroundsToCss, parseFills } from "../fill";
import { parseCssColor, warnRejectedColor } from "../css-color";
import { emitDiagnostic } from "../diagnostics";

/** Absolute-positioned container with size + transform + opacity.
 *  Animatable on `transform` and `opacity` only — width/height/position
 *  changes are intentionally *not* animatable to keep the broadcast
 *  off the layout path.
 *
 *  LSML 1.1 §4.3 + §4.12 add `backgrounds[]` as an alternative to the
 *  legacy `background` (single color). The array form supports stacked
 *  fills with linear / radial gradients ; first entry renders on top.
 *
 *  LSML 1.1 §4.3 `clipsContent` (default `true`) clips children outside
 *  the frame's bounds via `overflow: hidden` (ADR 001 §3.2.5, RC#5).
 */
export function Frame({
  resolved,
  nodeId,
  transitionFor,
  animateInitial,
  children,
}: PrimitiveProps) {
  const x = numberOr(resolved.x, 0);
  const y = numberOr(resolved.y, 0);
  const width = sizeProp(resolved.width);
  const height = sizeProp(resolved.height);
  const opacity = numberOr(resolved.opacity, 1);
  const scale = numberOr(resolved.scale, 1);
  const rotate = numberOr(resolved.rotate, 0);

  // 1.0 single-fill prop — used as fallback when 1.1 `backgrounds[]`
  // is empty. RC#11 : the value is untrusted (static prop OR live LSDP
  // delta) and lands in inline CSS — strict-parse, never passthrough.
  const rawBackground = resolved.background;
  const legacyBackground = rawBackground === undefined ? undefined : parseCssColor(rawBackground);
  if (rawBackground !== undefined && legacyBackground === null) {
    warnRejectedColor("frame.background", nodeId);
  }
  const backgrounds = parseFills(resolved.backgrounds, "frame.backgrounds", nodeId);
  const clipsContent = resolveClipsContent(resolved.clipsContent, nodeId);

  // Pick the most expressive declared transition among the animated
  // bindings (transform / opacity). If none, no animation.
  const tx = resolveTransition(
    transitionFor,
    ["opacity", "scale", "rotate", "x", "y"],
    animateInitial,
  );

  const style: CSSProperties = {
    position: "absolute",
    left: 0,
    top: 0,
    width,
    height,
    willChange: "transform, opacity",
    // LSML 1.1 §4.3 `clipsContent` (default `true`) — children outside
    // the frame's `size` are clipped. Static layout property : it never
    // animates, so it stays off the 0-layout-event hot path (ADR 001
    // §3.2.5). `false` => omit the declaration (CSS initial = visible).
    ...(clipsContent ? { overflow: "hidden" } : {}),
  };
  if (backgrounds.length > 0) {
    Object.assign(style, backgroundsToCss(backgrounds, nodeId));
  } else if (legacyBackground !== undefined && legacyBackground !== null) {
    style.background = legacyBackground;
  }

  const play = mountPlay({ opacity, x, y, scale, rotate }, animateInitial, nodeId);

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

/**
 * Resolve `clipsContent` (LSML 1.1 §4.3, schema default `true`).
 *
 * The prop is wire-drivable (static bundle prop OR live LSDP delta via
 * `resolveProps`, tree.tsx), so a non-boolean is treated as hostile :
 * R9 diagnostic (value withheld) + fall back to the spec default
 * (`true`, i.e. clipped — the safe state for broadcast). The returned
 * value only ever selects between two literal style fragments — no
 * untrusted value can reach inline CSS through this path (RC#11 by
 * construction). Exported for boundary testing.
 */
export function resolveClipsContent(v: unknown, nodeId?: string): boolean {
  if (v === undefined) return true;
  if (typeof v === "boolean") return v;
  emitDiagnostic(nodeId, "frame.clipsContent", "rejected value : not a boolean");
  return true;
}

function numberOr(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function sizeProp(v: unknown): number | string | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.length > 0) return v;
  return undefined;
}
