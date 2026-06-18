import { useMemo } from "react";
import { Tree } from "../render/tree";
import { AllowedHostsProvider, readAllowedHosts } from "../render/allowed-hosts";
import { ShapeIndexProvider, buildShapeIndex } from "../render/shape-index";
import { useLumencastRuntime } from "../overlay/runtime-context";

/** Broadcast mode : pure scene render, no UI chrome. */
export function BroadcastMode() {
  const { store, bundle } = useLumencastRuntime();
  // ADR 002 A2.1 (#K) — build the `id → shape` index once per bundle.
  const shapeIndex = useMemo(() => buildShapeIndex(bundle.root), [bundle.root]);
  return (
    <AllowedHostsProvider hosts={readAllowedHosts(bundle)}>
      <ShapeIndexProvider index={shapeIndex}>
        <Tree node={bundle.root} store={store} />
      </ShapeIndexProvider>
    </AllowedHostsProvider>
  );
}
