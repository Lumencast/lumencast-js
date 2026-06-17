import { Tree } from "../render/tree";
import { AllowedHostsProvider } from "../render/allowed-hosts";
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
      <AllowedHostsProvider hosts={bundle.assets?.allowedHosts}>
        <Tree node={bundle.root} store={store} />
      </AllowedHostsProvider>
      <StatusPill />
      <ControlPanel />
      <TestPanel />
    </>
  );
}
