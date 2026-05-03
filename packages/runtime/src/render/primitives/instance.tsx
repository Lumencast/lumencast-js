// LSML 1.1 §4.9 — `instance` primitive (composite-instance reuse).
//
// Mounts a sub-scene by `scene_id` + `scene_version`. The sub-scene's
// state is exposed to its tree under the `__params.*` reserved
// namespace ; resolution happens via the runtime's bundle fetcher.
//
// This implementation is a SCAFFOLD : the visual slot is rendered
// (size/position honoured) but the sub-tree is replaced by a
// "deferred load" placeholder until the async bundle-fetch path is
// wired. The composite-reuse rendering is the next iteration's work.
//
// What this primitive does today :
//   - parse scene_id, scene_version, params, fit, size, position
//   - reserve the slot in the parent layout
//   - log a one-time warning so authors know it's a scaffold
//
// What it does NOT do (yet) :
//   - fetch the inner bundle via the runtime's bundle resolver
//   - render the inner tree with __params.* injected into the store
//   - cycle detection (LSML 1.1 §4.9.2) — depth-8 limit applied at the
//     resolver layer rather than the renderer

import type { PrimitiveProps } from "./index";

const warned = new Set<string>();

export function Instance({ resolved }: PrimitiveProps): JSX.Element | null {
  const sceneId = resolved.scene_id as string | undefined;
  const sceneVersion = resolved.scene_version as string | undefined;
  if (!sceneId || !sceneVersion) {
    if (import.meta.env.DEV) {
      console.warn("[lumencast/instance] missing scene_id or scene_version", resolved);
    }
    return null;
  }

  // One-time DEV warning per (sceneId,version) so authors know the
  // scaffold limitation.
  if (import.meta.env.DEV) {
    const key = `${sceneId}:${sceneVersion}`;
    if (!warned.has(key)) {
      warned.add(key);
      console.warn(
        `[lumencast/instance] scaffold render — async bundle fetch + ` +
          `__params.* injection are not yet wired (LSML 1.1 §4.9). ` +
          `scene_id=${sceneId}`,
      );
    }
  }

  const size = resolved.size as { w?: number; h?: number } | undefined;
  const position = resolved.position as { x?: number; y?: number } | undefined;

  return (
    <div
      data-lumencast-instance={sceneId}
      data-lumencast-version={sceneVersion}
      style={{
        position: position ? "absolute" : "relative",
        left: position?.x,
        top: position?.y,
        width: size?.w,
        height: size?.h,
        outline: import.meta.env.DEV ? "1px dashed rgba(255,180,0,0.5)" : "none",
        boxSizing: "border-box",
      }}
    />
  );
}
