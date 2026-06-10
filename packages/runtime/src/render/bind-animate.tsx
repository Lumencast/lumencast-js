// LSML 1.1 §6.3 `bindAnimate` — continuous interpolation toward a live
// leaf value (ADR 001 §3.3, issue #33).
//
// Per binding, the hook subscribes the existing leaf-grain signal and
// retargets a Framer motion value on change — NO remount, the DOM node
// is identical before/after (RC#6). Scalar channels (§6.1) ride motion
// values attached to a wrapping `motion.div` ; colour channels (§6.5)
// are interpolated component-wise in sRGB through the strict shared
// parser and flow back into the primitive's resolved prop (which
// re-validates them — RC#11 belt and braces).
//
// Anti-DoS (Bastion RC#13) : deltas are coalesced per frame — one
// retarget max per rAF per binding, whatever the producer's rate
// (1 kHz tested in E2E). Retargets interrupt in-flight springs with
// velocity carry (§6.2/§6.4 — framer preserves a motion value's
// velocity when a spring animation is replaced ; no snap).
//
// R8 runtime half (issue #42) : `filter.blur` / `filter.brightness`
// values arriving live re-pass the same caps as the compiler before
// they may touch the composed CSS filter (see filter-clamp.ts).
//
// Stagger (§6.7) : inside a `repeat` iteration the FIRST animated
// retarget per binding is delayed by the ambient StaggerContext delay ;
// steady-state retargets are never delayed (a permanently-lagging gauge
// would defeat the purpose of a live binding). Documented hypothesis —
// the spec only constrains animation *starts*.

import {
  animate,
  useMotionValue,
  useTransform,
  type AnimationPlaybackControls,
  type MotionValue,
  type MotionStyle,
} from "framer-motion";
import { effect } from "@preact/signals-react";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Store } from "../state/store";
import type { RenderNode } from "./bundle";
import { scopedPath } from "./scope";
import { StaggerContext } from "./stagger-context";
import { toFramer, type FramerTransition, type Transition } from "../animate/transitions";
import { createFrameCoalescer } from "../animate/frame-coalescer";
import { clampFilterChannel, warnRejectedFilter } from "./filter-clamp";
import { warnRejectedColor } from "./css-color";
import { cssColorToRgba, mixRgba, serializeRgba, type Rgba } from "./color-interp";

/** §6.5 colour-typed bindAnimate keys → the runtime prop name the
 *  primitive reads (and re-validates through `parseCssColor`). */
export const BIND_ANIMATE_COLOR_PROPS: Readonly<Record<string, string>> = {
  "style.color": "colour",
  fill: "fill",
  background: "background",
};

/** Scalar motion channels a bindAnimate key drives. */
type ScalarChannel = "opacity" | "x" | "y" | "scaleX" | "scaleY" | "rotate" | "blur" | "brightness";

/**
 * Validate + normalise one live bindAnimate value into per-channel
 * numeric targets. Returns `null` on rejection (wrong JSON shape per
 * §6.3, non-finite numbers, filter values outside the R8 caps when the
 * channel rejects rather than clamps). A `null` keeps the last
 * known-good target — the raw input never reaches a style.
 *
 * Exported pure for the hostile-delta fixture suite (issue #42).
 */
export function resolveScalarTargets(
  key: string,
  raw: unknown,
): Partial<Record<ScalarChannel, number>> | null {
  switch (key) {
    case "opacity": {
      if (!isFiniteNumber(raw)) return null;
      return { opacity: raw < 0 ? 0 : raw > 1 ? 1 : raw };
    }
    case "transform.translate": {
      if (!Array.isArray(raw) || raw.length !== 2) return null;
      const [tx, ty] = raw;
      if (!isFiniteNumber(tx) || !isFiniteNumber(ty)) return null;
      return { x: tx, y: ty };
    }
    case "transform.scale": {
      if (isFiniteNumber(raw)) return { scaleX: raw, scaleY: raw };
      if (Array.isArray(raw) && raw.length === 2) {
        const [sx, sy] = raw;
        if (!isFiniteNumber(sx) || !isFiniteNumber(sy)) return null;
        return { scaleX: sx, scaleY: sy };
      }
      return null;
    }
    case "transform.rotate": {
      if (!isFiniteNumber(raw)) return null;
      return { rotate: raw };
    }
    case "filter.blur": {
      const v = clampFilterChannel("blur", raw);
      return v === null ? null : { blur: v };
    }
    case "filter.brightness": {
      const v = clampFilterChannel("brightness", raw);
      return v === null ? null : { brightness: v };
    }
    default:
      return null;
  }
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Default retarget transition when neither a per-leaf wire directive
 *  nor a compiled `transitions` entry resolves : the §6.2 default
 *  spring (stiffness 170, damping 26, mass 1). A spring is the only
 *  curve with well-defined retarget semantics (velocity carry) — a
 *  documented hypothesis, see the PR for issue #33. */
export const DEFAULT_BIND_ANIMATE_TRANSITION: Transition = {
  kind: "spring",
  stiffness: 170,
  damping: 26,
  mass: 1,
};

/** node.transitions lookup key for each bindAnimate key (mirrors the
 *  compiler's `transitionKeysForBindAnimate`). */
function transitionLookupKey(key: string): string {
  switch (key) {
    case "opacity":
      return "opacity";
    case "transform.translate":
      return "x";
    case "transform.scale":
      return "scale";
    case "transform.rotate":
      return "rotate";
    case "filter.blur":
    case "filter.brightness":
      return "filter";
    default:
      return BIND_ANIMATE_COLOR_PROPS[key] ?? key;
  }
}

export interface BindAnimateHandle {
  /** Motion-value style for the wrapping `motion.div` — `null` when no
   *  scalar channel is bound (no wrapper needed). */
  motionStyle: MotionStyle | null;
  /** Live-interpolated colour values, keyed by the primitive prop name
   *  (`colour` / `fill` / `background`). Merged over `resolved`. */
  colorProps: Record<string, string>;
}

const NO_COLORS: Record<string, string> = {};

/**
 * Drive a node's `animateBindings`. Must be called unconditionally
 * (hook) ; cheap no-op when the node has no bindings.
 */
export function useBindAnimate(node: RenderNode, store: Store, scope: string): BindAnimateHandle {
  const bindings = node.animateBindings;
  const staggerDelayMs = useContext(StaggerContext);

  // Fixed channel set — created unconditionally so hook order is
  // stable ; unbound channels stay at their identity value.
  const opacity = useMotionValue(1);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const scaleX = useMotionValue(1);
  const scaleY = useMotionValue(1);
  const rotate = useMotionValue(0);
  const blur = useMotionValue(0);
  const brightness = useMotionValue(1);
  // Composed CSS filter — both functions always present so framer
  // interpolates structurally-identical lists (same form as the
  // compiler emits, clamped per R8).
  const filter = useTransform(
    [blur, brightness] as [MotionValue<number>, MotionValue<number>],
    ([b, br]: number[]) => `blur(${b}px) brightness(${br})`,
  );

  const [colorProps, setColorProps] = useState<Record<string, string>>(NO_COLORS);

  const channels = useRef<Record<ScalarChannel, MotionValue<number>>>({
    opacity,
    x,
    y,
    scaleX,
    scaleY,
    rotate,
    blur,
    brightness,
  });

  useEffect(() => {
    if (!bindings || Object.keys(bindings).length === 0) return;

    const mvs = channels.current;
    const controls = new Map<string, AnimationPlaybackControls>();
    const colorState = new Map<string, { current: Rgba }>();
    const animatedOnce = new Set<string>();
    let mounted = false;

    const transitionFor = (key: string, fullPath: string): FramerTransition => {
      const live = store.transitionSignal(fullPath).peek();
      const declared = live ?? node.transitions?.[transitionLookupKey(key)];
      const base = toFramer(declared ?? DEFAULT_BIND_ANIMATE_TRANSITION);
      // §6.7 — stagger delays only the first animated retarget.
      if (staggerDelayMs > 0 && !animatedOnce.has(key)) {
        return { ...base, delay: staggerDelayMs / 1000 } as FramerTransition;
      }
      return base;
    };

    const dispatch = (key: string, value: unknown, instant: boolean): void => {
      const colorProp = BIND_ANIMATE_COLOR_PROPS[key];
      const fullPath = scopedPath(scope, bindings[key] as string);

      if (colorProp !== undefined) {
        // §6.5 — canonicalise BOTH endpoints through the strict parser
        // before interpolating ; never a raw string.
        const end = cssColorToRgba(value);
        if (end === null) {
          warnRejectedColor(`bindAnimate.${key}`);
          return;
        }
        const prev = colorState.get(key);
        if (instant || prev === undefined) {
          colorState.set(key, { current: end });
          setColorProps((p) => ({ ...p, [colorProp]: serializeRgba(end) }));
          return;
        }
        const start = prev.current;
        const tx = transitionFor(key, fullPath);
        animatedOnce.add(key);
        controls.get(`color:${key}`)?.stop();
        controls.set(
          `color:${key}`,
          animate(0, 1, {
            ...tx,
            onUpdate: (t) => {
              const mixed = mixRgba(start, end, t);
              prev.current = mixed;
              setColorProps((p) => ({ ...p, [colorProp]: serializeRgba(mixed) }));
            },
          }),
        );
        return;
      }

      const targets = resolveScalarTargets(key, value);
      if (targets === null) {
        // R9 — the offending value is never logged.
        if (key.startsWith("filter.")) warnRejectedFilter(`bindAnimate.${key}`);
        else warnRejectedBindValue(key);
        return;
      }
      if (instant) {
        // §6.3.1 — on mount the rendered state initialises from the
        // bound value instantly (there is no previous state).
        for (const [ch, v] of Object.entries(targets)) {
          mvs[ch as ScalarChannel].jump(v as number);
        }
        return;
      }
      const tx = transitionFor(key, fullPath);
      animatedOnce.add(key);
      for (const [ch, v] of Object.entries(targets)) {
        // framer's animate() replaces any in-flight animation on the
        // motion value and seeds the new spring with the value's
        // current velocity — §6.2 velocity carry, no snap.
        controls.set(ch, animate(mvs[ch as ScalarChannel], v as number, tx));
      }
    };

    // RC#13 — one retarget max per rAF per binding.
    const coalescer = createFrameCoalescer((key, value) => dispatch(key, value, false));

    const disposers = Object.entries(bindings).map(([key, path]) =>
      effect(() => {
        const v = store.signal(scopedPath(scope, path)).value;
        if (v === undefined) return;
        if (!mounted) dispatch(key, v, true);
        else coalescer.push(key, v);
      }),
    );
    mounted = true;

    return () => {
      for (const d of disposers) d();
      coalescer.dispose();
      for (const c of controls.values()) c.stop();
    };
    // node/store/scope identity changes re-wire every subscription ;
    // staggerDelayMs is stable per repeat iteration.
  }, [node, bindings, store, scope, staggerDelayMs]);

  const motionStyle = useMemo<MotionStyle | null>(() => {
    if (!bindings) return null;
    const style: MotionStyle = {};
    let any = false;
    for (const key of Object.keys(bindings)) {
      switch (key) {
        case "opacity":
          style.opacity = opacity;
          any = true;
          break;
        case "transform.translate":
          style.x = x;
          style.y = y;
          any = true;
          break;
        case "transform.scale":
          style.scaleX = scaleX;
          style.scaleY = scaleY;
          any = true;
          break;
        case "transform.rotate":
          style.rotate = rotate;
          any = true;
          break;
        case "filter.blur":
        case "filter.brightness":
          style.filter = filter;
          any = true;
          break;
        default:
          break; // colour keys flow through colorProps, not the wrapper
      }
    }
    if (!any) return null;
    style.willChange = "transform, opacity, filter";
    return style;
  }, [bindings, opacity, x, y, scaleX, scaleY, rotate, filter]);

  return { motionStyle, colorProps };
}

/** R9 diagnostic — shape-invalid bindAnimate value (non-filter
 *  channels). DEV-only, value withheld. */
function warnRejectedBindValue(key: string): void {
  if (import.meta.env.DEV) {
    console.warn(
      `[lumencast] rejected bindAnimate value for "${key}" : ` +
        "JSON shape does not match the property type (LSML §6.3, value withheld per R9)",
    );
  }
}
