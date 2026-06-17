import { Tree } from "../render/tree";
import { useLumencastRuntime } from "../overlay/runtime-context";
import { AllowedHostsProvider, readAllowedHosts } from "../render/allowed-hosts";

/** Broadcast mode : pure scene render, no UI chrome. */
export function BroadcastMode() {
  const { store, bundle } = useLumencastRuntime();
  return (
    <AllowedHostsProvider allowedHosts={readAllowedHosts(bundle)}>
      <Tree node={bundle.root} store={store} />
    </AllowedHostsProvider>
  );
}
