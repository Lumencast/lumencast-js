import type { SnapshotFrame } from "@lumencast/protocol";
import type { Store } from "./store.js";

/** Apply an LSDP/1 snapshot to the store. Replaces the entire state — paths
 *  not present in the snapshot are reset to `undefined`. */
export function applySnapshot(store: Store, frame: SnapshotFrame): void {
  store.reset(frame.state);
}
