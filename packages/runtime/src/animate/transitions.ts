// Local Transition type + Framer Motion translation.
//
// LSML 1.0 §6 declares `animate` directives at the primitive level (transition,
// transform, opacity, filter). Per-patch transitions are NOT a LSDP/1 concept —
// they would require a protocol extension. For v0.1.0 the runtime supports only
// scene-level transitions declared in the bundle.
//
// We deliberately animate only GPU-friendly properties (transform, opacity,
// filter). Primitives enforce this at the DOM level by exposing those props as
// motion-bindable values rather than raw CSS.

export type TransitionKind = "none" | "tween" | "spring" | "crossfade";

export interface TweenTransition {
  kind: "tween";
  duration_ms: number;
  ease?: "linear" | "cubic-in" | "cubic-out" | "cubic-in-out";
}

export interface SpringTransition {
  kind: "spring";
  stiffness?: number;
  damping?: number;
}

export interface CrossfadeTransition {
  kind: "crossfade";
  duration_ms?: number;
}

export interface NoTransition {
  kind: "none";
}

export type Transition = NoTransition | TweenTransition | SpringTransition | CrossfadeTransition;

export type FramerEasing = "linear" | "easeIn" | "easeOut" | "easeInOut";

export interface FramerTransition {
  duration?: number;
  ease?: FramerEasing;
  type?: "tween" | "spring";
  stiffness?: number;
  damping?: number;
}

const NO_ANIMATION: FramerTransition = { duration: 0 };

const EASE_MAP: Record<string, FramerEasing> = {
  linear: "linear",
  "cubic-in": "easeIn",
  "cubic-out": "easeOut",
  "cubic-in-out": "easeInOut",
};

export function toFramer(t: Transition | undefined): FramerTransition {
  if (!t || t.kind === "none") return NO_ANIMATION;
  if (t.kind === "tween") {
    return {
      type: "tween",
      duration: (t.duration_ms ?? 0) / 1000,
      ease: t.ease ? (EASE_MAP[t.ease] ?? "easeOut") : "easeOut",
    };
  }
  if (t.kind === "spring") {
    return {
      type: "spring",
      ...(t.stiffness !== undefined ? { stiffness: t.stiffness } : {}),
      ...(t.damping !== undefined ? { damping: t.damping } : {}),
    };
  }
  // crossfade at the per-prop level degenerates into a tween on opacity.
  return {
    type: "tween",
    duration: (t.duration_ms ?? 400) / 1000,
    ease: "easeInOut",
  };
}
