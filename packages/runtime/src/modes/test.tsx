import { Tree } from "../render/tree";
import { ControlPanel } from "../overlay/control";
import { TestPanel } from "../overlay/test";
import { StatusPill } from "../overlay/status-pill";
import { useLumencastRuntime } from "../overlay/runtime-context";

/** Test mode : scene + operator overlay + test extensions (adapter
 *  mocker, state inspector, time controls). */
export function TestMode() {
  const { store, bundle } = useLumencastRuntime();
  return (
    <>
      <Tree node={bundle.root} store={store} />
      <StatusPill />
      <ControlPanel />
      <TestPanel />
    </>
  );
}
