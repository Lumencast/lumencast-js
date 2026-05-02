import { Tree } from "../render/tree";
import { ControlPanel } from "../overlay/control";
import { StatusPill } from "../overlay/status-pill";
import { useLumencastRuntime } from "../overlay/runtime-context";

/** Control mode : scene + operator overlay (status pill + fields
 *  panel from operator_inputs). */
export function ControlMode() {
  const { store, bundle } = useLumencastRuntime();
  return (
    <>
      <Tree node={bundle.root} store={store} />
      <StatusPill />
      <ControlPanel />
    </>
  );
}
