import { batch } from "@preact/signals-react";
import type { DeltaFrame } from "@lumencast/protocol";
import type { Store } from "./store.js";

/** Apply an LSDP/1 delta. All patches in the frame land in a single signals
 *  batch — components reading multiple paths see them flip in one render pass. */
export function applyDelta(store: Store, frame: DeltaFrame): void {
  batch(() => {
    for (const patch of frame.patches) {
      store.set(patch.path, patch.value);
    }
  });
}
