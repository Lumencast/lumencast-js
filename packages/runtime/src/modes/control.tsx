import { Tree } from "../render/tree";
import { ControlPanel } from "../overlay/control";
import { StatusPill } from "../overlay/status-pill";
import { useLumencastRuntime } from "../overlay/runtime-context";
import { AllowedHostsProvider, readAllowedHosts } from "../render/allowed-hosts";

/** Control mode : scene + operator overlay (status pill + fields
 *  panel from operator_inputs). */
export function ControlMode() {
  const { store, bundle } = useLumencastRuntime();
  return (
    <>
      <AllowedHostsProvider allowedHosts={readAllowedHosts(bundle)}>
        <Tree node={bundle.root} store={store} />
      </AllowedHostsProvider>
      <StatusPill />
      <ControlPanel />
    </>
  );
}
