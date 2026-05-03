// Local Transition type + Framer Motion translation.
//
// LSML 1.0 §6 declares `animate` directives at the primitive level (transition,
// transform, opacity, filter). LSDP/1.1 §3.2.2 added per-leaf transition
// directives on delta patches — incoming deltas can carry a transition hint
// that overrides the bundle-level default for the next animation cycle.
// `parseWireTransition` ingests the wire shape ; `Store.lastTransition(path)`
// surfaces the most-recent directive to the renderer.
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

/**
 * Parse a wire-format `TransitionSpec` (LSDP/1.1 §3.2.2) into the
 * runtime's local Transition type. Returns `undefined` for malformed
 * input so the caller falls back to whatever bundle-level default
 * applies. The wire shape uses kebab-case `easing` values
 * (`linear`, `ease-in`, `ease-out`, `ease-in-out`) which we map to
 * the runtime's `cubic-*` vocabulary.
 */
export function parseWireTransition(value: unknown): Transition | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const v = value as Record<string, unknown>;
  const kind = v.kind;
  if (kind === "snap") {
    return { kind: "none" };
  }
  if (kind === "tween") {
    const duration_ms = typeof v.duration_ms === "number" ? v.duration_ms : 0;
    const easing = WIRE_EASING_MAP[v.easing as string] ?? "cubic-out";
    return { kind: "tween", duration_ms, ease: easing };
  }
  if (kind === "spring") {
    const out: SpringTransition = { kind: "spring" };
    if (typeof v.stiffness === "number") out.stiffness = v.stiffness;
    if (typeof v.damping === "number") out.damping = v.damping;
    return out;
  }
  return undefined;
}

const WIRE_EASING_MAP: Record<string, "linear" | "cubic-in" | "cubic-out" | "cubic-in-out"> = {
  linear: "linear",
  "ease-in": "cubic-in",
  "ease-out": "cubic-out",
  "ease-in-out": "cubic-in-out",
};
