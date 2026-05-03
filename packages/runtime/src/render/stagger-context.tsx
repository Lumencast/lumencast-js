// LSML 1.1 §6.7 — stagger context.
//
// `repeat.stagger_ms` produces wave-like reveals : iteration N's
// animations start `N * stagger_ms` after iteration 0. The Repeat
// renderer computes the per-iteration delay and threads it through
// React context so KeyframePlayer (and future animate-aware primitives)
// can pick it up without per-primitive wiring.

import { createContext } from "react";

/** Per-iteration stagger delay in milliseconds. `0` means no offset
 *  (the implicit default outside a staggered repeat). */
export const StaggerContext = createContext<number>(0);

/** Spec hint : runtimes MAY cap effective stagger to avoid pathological
 *  wait times on large lists. We cap at 2 s. */
export const STAGGER_CAP_MS = 2000;

/** Compute the effective per-iteration delay, applying the runtime cap. */
export function computeStaggerDelayMs(index: number, staggerMs: number): number {
  if (staggerMs <= 0) return 0;
  const raw = index * staggerMs;
  return raw > STAGGER_CAP_MS ? STAGGER_CAP_MS : raw;
}
