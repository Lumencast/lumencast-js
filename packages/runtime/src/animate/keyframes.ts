// LSML 1.1 §6.6 — keyframe sequence playback.
//
// A primitive's `keyframes` block describes a path through animatable
// property values over time, applied once on (re)mount or whenever the
// `key` LeafPath value changes. The shapes here mirror the spec verbatim
// ; `compileForFramer` flattens them into the per-property arrays
// (`scale: [0.8, 1.05, 1]`) plus `times: [0, 0.6, 1]` that framer-motion
// expects on its `animate` / `transition` props.

export type KeyframeEasing = "linear" | "ease-in" | "ease-out" | "ease-in-out";

export interface KeyframeStep {
  /** Timeline position in [0, 1]. First step is 0 ; last step is 1. */
  at: number;
  /** Optional transform target at this waypoint. */
  transform?: KeyframeTransform;
  /** Optional opacity in [0, 1]. */
  opacity?: number;
  /** Optional CSS filter string. */
  filter?: string;
}

export interface KeyframeTransform {
  scale?: number;
  translateX?: number;
  translateY?: number;
  rotate?: number;
}

export interface Keyframes {
  /** LeafPath whose value-change replays the sequence. Omitted = mount-only. */
  key?: string;
  steps: KeyframeStep[];
  duration_ms: number;
  easing?: KeyframeEasing;
}

const FRAMER_EASE_MAP: Record<KeyframeEasing, "linear" | "easeIn" | "easeOut" | "easeInOut"> = {
  linear: "linear",
  "ease-in": "easeIn",
  "ease-out": "easeOut",
  "ease-in-out": "easeInOut",
};

export interface CompiledKeyframes {
  /** Per-CSS-property animate target (array of values, one per step). */
  animate: Record<string, (number | string)[]>;
  /** Framer transition config — duration in seconds, ease curve, times[]. */
  transition: {
    duration: number;
    ease: "linear" | "easeIn" | "easeOut" | "easeInOut";
    times: number[];
  };
}

/**
 * Flatten a 1.1 keyframe sequence into the per-property arrays + times[]
 * shape framer-motion expects. Returns `undefined` when `steps` is empty
 * or invariants are violated (first.at !== 0 or last.at !== 1) — the
 * caller then falls back to no animation.
 */
export function compileForFramer(kf: Keyframes): CompiledKeyframes | undefined {
  const steps = kf.steps;
  if (!Array.isArray(steps) || steps.length < 2) return undefined;
  const first = steps[0];
  const last = steps[steps.length - 1];
  if (first.at !== 0 || last.at !== 1) return undefined;

  const times = steps.map((s) => s.at);
  const animate: Record<string, (number | string)[]> = {};

  // For each animatable property, pull the value at every step. When a
  // step omits the property, we fall back to the previous step's value
  // (last-known-good) so framer-motion sees a coherent waypoint chain.
  pullChannel(steps, "opacity", animate);
  pullChannel(steps, "filter", animate);
  pullTransform(steps, "scale", animate);
  pullTransform(steps, "translateX", animate);
  pullTransform(steps, "translateY", animate);
  pullTransform(steps, "rotate", animate);

  return {
    animate,
    transition: {
      duration: kf.duration_ms / 1000,
      ease: FRAMER_EASE_MAP[kf.easing ?? "linear"],
      times,
    },
  };
}

function pullChannel(
  steps: KeyframeStep[],
  prop: "opacity" | "filter",
  out: Record<string, (number | string)[]>,
): void {
  let any = false;
  const values: (number | string)[] = [];
  let last: number | string | undefined;
  for (const s of steps) {
    const v = s[prop];
    if (v !== undefined) {
      any = true;
      last = v;
      values.push(v);
    } else {
      values.push(last ?? (prop === "opacity" ? 1 : "none"));
    }
  }
  if (any) out[prop] = values;
}

function pullTransform(
  steps: KeyframeStep[],
  prop: keyof KeyframeTransform,
  out: Record<string, (number | string)[]>,
): void {
  let any = false;
  const values: number[] = [];
  let last: number | undefined;
  for (const s of steps) {
    const v = s.transform?.[prop];
    if (typeof v === "number") {
      any = true;
      last = v;
      values.push(v);
    } else {
      values.push(last ?? defaultFor(prop));
    }
  }
  if (any) {
    if (prop === "rotate") {
      out.rotate = values.map((n) => `${n}deg`);
    } else {
      out[prop] = values;
    }
  }
}

function defaultFor(prop: keyof KeyframeTransform): number {
  return prop === "scale" ? 1 : 0;
}
