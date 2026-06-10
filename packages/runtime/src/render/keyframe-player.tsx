// LSML 1.1 §6.6 — keyframe sequence playback wrapper.
//
// Wraps a primitive subtree in a framer-motion `motion.div` that plays
// out the compiled keyframe arrays once on (re)mount, or whenever the
// bound `key` LeafPath changes. We trigger replay via React's `key=`
// reconciliation — bumping a counter when the keyframe key value flips
// remounts the motion subtree, restarting the animation from `at: 0`.
//
// LSML 1.1 §6.7 — when this player runs inside a `repeat` iteration, a
// `staggerDelay` (ms) is provided through `StaggerContext` and added to
// framer's transition.delay so each iteration starts `index * stagger_ms`
// after the previous one.

import { motion } from "framer-motion";
import { useContext, useEffect, useRef, type ReactNode } from "react";
import { useSignals } from "@preact/signals-react/runtime";
import type { Store } from "../state/store";
import { compileForFramer, type Keyframes } from "../animate/keyframes";
import { StaggerContext } from "./stagger-context";
import { scopedPath, usePathScope } from "./scope";

export interface KeyframePlayerProps {
  keyframes: Keyframes;
  store: Store;
  /** `RenderNode.id` of the owning node — threaded into keyframe
   *  diagnostics (ADR 001 RC#7, issue #34). */
  nodeId?: string;
  children: ReactNode;
}

export function KeyframePlayer({
  keyframes,
  store,
  nodeId,
  children,
}: KeyframePlayerProps): ReactNode {
  useSignals();
  const scope = usePathScope();
  const staggerDelayMs = useContext(StaggerContext);

  // Pull the latest `key` LeafPath value and remount whenever it
  // changes. We track via a ref + counter so React's reconciliation
  // gives us a fresh motion.div (and thus a fresh animation pass).
  const lastKeyValue = useRef<unknown>(undefined);
  const replayTokenRef = useRef(0);
  if (keyframes.key !== undefined) {
    const v = store.signal(scopedPath(scope, keyframes.key)).value;
    if (lastKeyValue.current !== v) {
      lastKeyValue.current = v;
      replayTokenRef.current += 1;
    }
  }

  const compiled = compileForFramer(keyframes, nodeId);
  if (!compiled) {
    return <>{children}</>;
  }

  const transition =
    staggerDelayMs > 0
      ? { ...compiled.transition, delay: staggerDelayMs / 1000 }
      : compiled.transition;

  return (
    <motion.div
      key={replayTokenRef.current}
      style={{ display: "contents" }}
      initial={firstFrame(compiled.animate)}
      animate={compiled.animate}
      transition={transition}
    >
      <ReplayOnMount />
      {children}
    </motion.div>
  );
}

/** No-op effect placeholder — kept for symmetry / future hooks like
 *  reporting playback completion to the renderer. */
function ReplayOnMount(): null {
  useEffect(() => {
    // intentional no-op
  }, []);
  return null;
}

/** Pluck the `at: 0` waypoint values into a framer-motion `initial` prop
 *  so the very first frame matches the start of the keyframe path. Without
 *  this, framer interpolates from the element's current style which can
 *  produce a visible jump on mount. */
function firstFrame(animate: Record<string, (number | string)[]>): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  for (const [k, arr] of Object.entries(animate)) {
    if (arr.length > 0) out[k] = arr[0];
  }
  return out;
}
