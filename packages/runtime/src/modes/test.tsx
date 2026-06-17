import { Tree } from "../render/tree";
import { ControlPanel } from "../overlay/control";
import { TestPanel } from "../overlay/test";
import { StatusPill } from "../overlay/status-pill";
import { useLumencastRuntime } from "../overlay/runtime-context";
import { AllowedHostsProvider, readAllowedHosts } from "../render/allowed-hosts";

/** Test mode : scene + operator overlay + test extensions (adapter
 *  mocker, state inspector, time controls). */
export function TestMode() {
  const { store, bundle } = useLumencastRuntime();
  return (
    <>
      <AllowedHostsProvider allowedHosts={readAllowedHosts(bundle)}>
        <Tree node={bundle.root} store={store} />
      </AllowedHostsProvider>
      <StatusPill />
      <ControlPanel />
      <TestPanel />
    </>
  );
}
