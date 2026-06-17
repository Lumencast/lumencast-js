import { Tree } from "../render/tree";
import { AllowedHostsProvider, readAllowedHosts } from "../render/allowed-hosts";
import { useLumencastRuntime } from "../overlay/runtime-context";

/** Broadcast mode : pure scene render, no UI chrome. */
export function BroadcastMode() {
  const { store, bundle } = useLumencastRuntime();
  return (
    <AllowedHostsProvider hosts={readAllowedHosts(bundle)}>
      <Tree node={bundle.root} store={store} />
    </AllowedHostsProvider>
  );
}
