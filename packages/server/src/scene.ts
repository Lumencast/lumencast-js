// Scene — the server's authoritative view of one Lumencast scene.
// Wraps a LeafStore + identity (sceneId, sceneVersion) and exposes a typed
// `update()` that emits patches the server broadcasts as `delta` frames.

import type { LeafPath, LeafValue, Patch, SceneId, SceneVersion } from "@lumencast/protocol";
import { LeafStore } from "./store.js";

export interface SceneInit {
  sceneId: SceneId;
  sceneVersion: SceneVersion;
  initialState?: Record<LeafPath, LeafValue>;
}

export interface Scene {
  readonly sceneId: SceneId;
  readonly sceneVersion: SceneVersion;
  readonly store: LeafStore;
  /** Update one or more leaves. Atomic per call. */
  update(patches: Patch[] | Record<LeafPath, LeafValue>): void;
  /** Subscribe to all patches emitted by this scene. */
  onPatches(listener: (patches: Patch[]) => void): () => void;
}

export function createScene(init: SceneInit): Scene {
  const store = new LeafStore(init.initialState ?? {});

  function update(input: Patch[] | Record<LeafPath, LeafValue>): void {
    const patches: Patch[] = Array.isArray(input)
      ? input
      : Object.entries(input).map(([path, value]) => ({ path, value }));
    store.apply(patches);
  }

  return {
    sceneId: init.sceneId,
    sceneVersion: init.sceneVersion,
    store,
    update,
    onPatches: (listener) => store.onPatches(listener),
  };
}
