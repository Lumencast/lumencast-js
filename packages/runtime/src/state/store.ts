// State store — one signal per leaf path.
//
// Integration point between the WS layer (snapshot + delta) and the render
// layer. Each path Lumencast has ever seen owns a `Signal<unknown>`;
// readers subscribe via @preact/signals-react `useSignals()` and re-render
// only when their path's value changes.
//
// LSDP/1.1 §3.2.2 — incoming deltas may carry a per-leaf `transition`
// directive. The store keeps the most-recent directive per path so the
// renderer can pick it up on the next animation cycle. Snapshots clear
// any pending transitions for the affected paths (snapshots are not
// animated transitions).

import { signal, type Signal, batch } from "@preact/signals-react";
import type { Transition } from "../animate/transitions";

export interface Store {
  /** Get-or-create the signal for a path. New paths start as `undefined`. */
  signal(path: string): Signal<unknown>;
  /** Apply a single leaf write. */
  set(path: string, value: unknown): void;
  /** Apply a single leaf write with an LSDP/1.1 §3.2.2 transition directive.
   * The directive lives in a separate signal so the renderer can subscribe
   * to it independently. Passing `undefined` clears any pending directive. */
  setWithTransition(path: string, value: unknown, transition: Transition | undefined): void;
  /** Read the most-recent transition directive for a path (or undefined
   * when no directive has been applied since the last snapshot). The
   * returned signal is reactive — components reading via `useSignals()`
   * re-render when the directive changes. */
  transitionSignal(path: string): Signal<Transition | undefined>;
  /**
   * Replace the whole state — used by `apply-snapshot`. Existing signals are
   * reused (subscribers stay attached); paths missing from the snapshot reset
   * to `undefined`. Pending per-path transitions are cleared (a snapshot is
   * a state restore, not an animated change).
   */
  reset(state: Record<string, unknown>): void;
  /** Snapshot of every known path → current value. For debug / state inspector. */
  toRecord(): Record<string, unknown>;
}

class StoreImpl implements Store {
  private readonly signals = new Map<string, Signal<unknown>>();
  private readonly transitions = new Map<string, Signal<Transition | undefined>>();

  signal(path: string): Signal<unknown> {
    let s = this.signals.get(path);
    if (!s) {
      s = signal<unknown>(undefined);
      this.signals.set(path, s);
    }
    return s;
  }

  transitionSignal(path: string): Signal<Transition | undefined> {
    let s = this.transitions.get(path);
    if (!s) {
      s = signal<Transition | undefined>(undefined);
      this.transitions.set(path, s);
    }
    return s;
  }

  set(path: string, value: unknown): void {
    const s = this.signal(path);
    if (!shallowEqual(s.peek(), value)) {
      s.value = value;
    }
  }

  setWithTransition(path: string, value: unknown, transition: Transition | undefined): void {
    batch(() => {
      const ts = this.transitionSignal(path);
      // Update transition before value so the render that observes the
      // new value sees the correct transition.
      if (ts.peek() !== transition) ts.value = transition;
      const s = this.signal(path);
      if (!shallowEqual(s.peek(), value)) s.value = value;
    });
  }

  reset(state: Record<string, unknown>): void {
    batch(() => {
      const seen = new Set<string>();
      for (const [path, value] of Object.entries(state)) {
        seen.add(path);
        const s = this.signal(path);
        if (!shallowEqual(s.peek(), value)) {
          s.value = value;
        }
        // Snapshots are not animated transitions — clear any pending
        // per-path directive (LSDP/1.1 §3.2.2 — directives apply to
        // the NEXT delta only, snapshots reseed state authoritatively).
        const ts = this.transitions.get(path);
        if (ts && ts.peek() !== undefined) ts.value = undefined;
      }
      for (const path of this.signals.keys()) {
        if (!seen.has(path)) {
          const s = this.signals.get(path);
          if (s && s.peek() !== undefined) s.value = undefined;
        }
      }
    });
  }

  toRecord(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [path, s] of this.signals.entries()) {
      out[path] = s.peek();
    }
    return out;
  }
}

export function createStore(): Store {
  return new StoreImpl();
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao);
  const bk = Object.keys(bo);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (ao[k] !== bo[k]) return false;
  }
  return true;
}
