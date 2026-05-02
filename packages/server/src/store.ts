// LeafStore — a leaf-grain key/value map with an `onPatches` event.
// Adapters write into the store; the Scene listens and rebroadcasts as deltas.

import type { LeafPath, LeafValue, Patch } from "@lumencast/protocol";

export type LeafStoreListener = (patches: Patch[]) => void;

export class LeafStore {
  private state: Record<LeafPath, LeafValue> = {};
  private listeners = new Set<LeafStoreListener>();

  constructor(initial: Record<LeafPath, LeafValue> = {}) {
    this.state = { ...initial };
  }

  /** Snapshot of the full state (shallow copy). */
  snapshot(): Record<LeafPath, LeafValue> {
    return { ...this.state };
  }

  /** Read a single leaf. */
  get(path: LeafPath): LeafValue | undefined {
    return this.state[path];
  }

  /** Apply patches and notify listeners. Returns the patches actually applied. */
  apply(patches: Patch[]): Patch[] {
    if (patches.length === 0) return [];
    for (const p of patches) this.state[p.path] = p.value;
    for (const l of this.listeners) l(patches);
    return patches;
  }

  onPatches(listener: LeafStoreListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
