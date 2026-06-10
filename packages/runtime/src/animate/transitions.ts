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

// --- mount-play (LSML 1.1 `animate.from`) ---------------------------

/** Identity (animation-end) value for each framer key an `animate.from`
 *  may declare. A primitive that doesn't natively animate a given key
 *  still converges it to this neutral value on mount so the element ends
 *  up visually correct (e.g. a `from.scale: 0.85` settles at `scale: 1`). */
const INITIAL_IDENTITY: Record<string, number | string> = {
  opacity: 1,
  scale: 1,
  scaleX: 1,
  scaleY: 1,
  rotate: 0,
  x: 0,
  y: 0,
  // LSML §6.1 filter identity — both functions are always present so
  // framer interpolates between structurally-identical filter lists
  // (the compiler emits the same two-function form, clamped per R8).
  filter: "blur(0px) brightness(1)",
};

export interface MountPlay {
  initial: Record<string, number | string>;
  animate: Record<string, number | string>;
}

/**
 * Default mount-play timing — applies when a node carries an
 * `animate_initial` (LSML 1.1 `animate.from`) but no per-prop
 * `transitions` entry resolves for any animated key. The compiler
 * documents that `from` without an explicit `transition` mount-plays
 * "with the runtime's default timing" ; before this constant existed the
 * fallback was `toFramer(undefined)` → `{ duration: 0 }`, which snapped
 * the element straight to its settled state (the mount-play never
 * visibly played). 400 ms ease-out matches the runtime's other implicit
 * timings (crossfade fallback, scene-track fade).
 */
export const DEFAULT_MOUNT_PLAY_TRANSITION: Transition = {
  kind: "tween",
  duration_ms: 400,
  ease: "cubic-out",
};

/**
 * Resolve the transition a primitive should hand framer-motion.
 *
 * `keys` are the primitive's native animated prop keys, scanned in
 * order (e.g. `["opacity", "src"]` for Image). When the node also
 * carries an `animate_initial`, the lookup widens to the keys the
 * mount-play actually moves (`from.scale` may have lowered a `scale`
 * transition that an opacity-only primitive would otherwise never look
 * up), and — critically — falls back to
 * `DEFAULT_MOUNT_PLAY_TRANSITION` instead of "no animation" : a
 * mount-play must tween, never complete in zero frames.
 *
 * Without `animate_initial` the prior behaviour is preserved exactly :
 * first declared transition among `keys`, else `undefined` (deltas
 * snap unless a transition is declared).
 */
export function resolveTransition(
  transitionFor: (key: string) => Transition | undefined,
  keys: string[],
  animateInitial?: Record<string, number | string>,
): Transition | undefined {
  for (const key of keys) {
    const t = transitionFor(key);
    if (t !== undefined) return t;
  }
  if (animateInitial && Object.keys(animateInitial).length > 0) {
    for (const key of Object.keys(animateInitial)) {
      const t = transitionFor(key);
      if (t !== undefined) return t;
    }
    return DEFAULT_MOUNT_PLAY_TRANSITION;
  }
  return undefined;
}

/**
 * Build framer-motion `initial` / `animate` props for a primitive that
 * may carry an LSML 1.1 `animate.from` initial state.
 *
 * `base` is the primitive's own animated target (e.g. `{ opacity }` for
 * Image/Text/Shape, or `{ opacity, x, y, scale, rotate }` for Frame).
 * `initial` is the lowered `animate.from` map (or `undefined`).
 *
 * When `initial` is absent, this returns `{ initial: base, animate: base }`
 * — framer mounts at the target and never moves, exactly the prior
 * no-mount-play behaviour (backward compatible). When `initial` is
 * present, the element mounts at `initial` and animates to `base`,
 * augmented with identity convergence for any `from` key the primitive
 * doesn't already drive — so the mount-play plays out and settles
 * correctly even on opacity-only primitives.
 */
export function mountPlay(
  base: Record<string, number | string>,
  initial: Record<string, number | string> | undefined,
): MountPlay {
  if (!initial || Object.keys(initial).length === 0) {
    // No `from` → mount directly at target. Pinning `initial` to the
    // target (rather than letting framer infer from current style)
    // preserves the existing "no jump, no mount-play" behaviour.
    return { initial: base, animate: base };
  }
  const animate: Record<string, number | string> = { ...base };
  for (const key of Object.keys(initial)) {
    if (!(key in animate)) {
      animate[key] = INITIAL_IDENTITY[key] ?? 0;
    }
  }
  return { initial, animate };
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
