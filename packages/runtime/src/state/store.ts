// State store — one signal per leaf path.
//
// Integration point between the WS layer (snapshot + delta) and the render
// layer. Each path Lumencast has ever seen owns a `Signal<unknown>`;
// readers subscribe via @preact/signals-react `useSignals()` and re-render
// only when their path's value changes.

import { signal, type Signal, batch } from "@preact/signals-react";

export interface Store {
  /** Get-or-create the signal for a path. New paths start as `undefined`. */
  signal(path: string): Signal<unknown>;
  /** Apply a single leaf write. */
  set(path: string, value: unknown): void;
  /**
   * Replace the whole state — used by `apply-snapshot`. Existing signals are
   * reused (subscribers stay attached); paths missing from the snapshot reset
   * to `undefined`.
   */
  reset(state: Record<string, unknown>): void;
  /** Snapshot of every known path → current value. For debug / state inspector. */
  toRecord(): Record<string, unknown>;
}

class StoreImpl implements Store {
  private readonly signals = new Map<string, Signal<unknown>>();

  signal(path: string): Signal<unknown> {
    let s = this.signals.get(path);
    if (!s) {
      s = signal<unknown>(undefined);
      this.signals.set(path, s);
    }
    return s;
  }

  set(path: string, value: unknown): void {
    const s = this.signal(path);
    if (!shallowEqual(s.peek(), value)) {
      s.value = value;
    }
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
