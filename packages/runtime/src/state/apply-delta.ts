import { batch } from "@preact/signals-react";
import type { DeltaFrame } from "@lumencast/protocol";
import type { Store } from "./store.js";
import { parseWireTransition } from "../animate/transitions";

/** Apply an LSDP/1 delta. All patches in the frame land in a single signals
 *  batch — components reading multiple paths see them flip in one render pass.
 *
 *  LSDP/1.1 §3.2.2 — a patch may carry a `transition` directive overriding
 *  the bundle-level default for the next animation cycle on that leaf. We
 *  thread it through the store so the renderer reads the correct directive
 *  alongside the new value. */
export function applyDelta(store: Store, frame: DeltaFrame): void {
  batch(() => {
    for (const patch of frame.patches) {
      const transition = parseWireTransition(patch.transition);
      if (transition !== undefined) {
        store.setWithTransition(patch.path, patch.value, transition);
      } else {
        store.set(patch.path, patch.value);
      }
    }
  });
}
