// LeafStore — a leaf-grain key/value map with an `onPatches` event.
// Adapters write into the store; the Scene listens and rebroadcasts as deltas.

import type { Cause, LeafPath, LeafValue, Patch } from "@lumencast/protocol";

export type LeafStoreListener = (patches: Patch[], cause?: Cause) => void;

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

  /** Apply patches and notify listeners. Returns the patches actually applied.
   * Optional `cause` is forwarded to listeners so a downstream delta can carry
   * provenance (LSDP/1.1 §3.2.3). */
  apply(patches: Patch[], cause?: Cause): Patch[] {
    if (patches.length === 0) return [];
    for (const p of patches) this.state[p.path] = p.value;
    for (const l of this.listeners) l(patches, cause);
    return patches;
  }

  onPatches(listener: LeafStoreListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
