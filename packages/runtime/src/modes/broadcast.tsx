import { Tree } from "../render/tree";
import { useLumencastRuntime } from "../overlay/runtime-context";

/** Broadcast mode : pure scene render, no UI chrome. */
export function BroadcastMode() {
  const { store, bundle } = useLumencastRuntime();
  return <Tree node={bundle.root} store={store} />;
}
