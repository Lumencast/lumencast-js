// Allowed-hosts context (LSML 1.2, ADR 002 #E ; Bastion T1/T2).
//
// The bundle's `assets.allowedHosts` is the single allowlist every untrusted
// asset URL is matched against before it reaches the DOM. The mask builder
// (and, once #F lands, image-fill) needs it deep in the tree, so it rides a
// React context provided once at the render root. The default is `undefined`
// — deny-by-default : with no provider, every remote host is rejected.
//
// This is a read-only, mount-stable value (the allowlist is part of the
// content-addressed bundle), so a plain context is the right tool.

import { createContext, useContext, type ReactNode } from "react";

const AllowedHostsContext = createContext<readonly string[] | undefined>(undefined);

export function AllowedHostsProvider({
  allowedHosts,
  children,
}: {
  allowedHosts: readonly string[] | undefined;
  children: ReactNode;
}) {
  return (
    <AllowedHostsContext.Provider value={allowedHosts}>{children}</AllowedHostsContext.Provider>
  );
}

/** The bundle's allowlist, or `undefined` (deny every remote host). */
export function useAllowedHosts(): readonly string[] | undefined {
  return useContext(AllowedHostsContext);
}

/** Read `assets.allowedHosts` defensively off a render bundle. The runtime
 *  `RenderBundle.assets` type is the legacy `Asset[]` form ; the LSML 1.2
 *  compiler emits the object form `{ allowedHosts?: string[] }`. Either way
 *  we extract a string[] of hostnames, or `undefined` (deny-by-default). A
 *  non-string entry is dropped — it can never match `new URL().hostname`. */
export function readAllowedHosts(bundle: { assets?: unknown }): readonly string[] | undefined {
  const assets = bundle.assets as { allowedHosts?: unknown } | undefined;
  const list = assets?.allowedHosts;
  if (!Array.isArray(list)) return undefined;
  const hosts = list.filter((h): h is string => typeof h === "string");
  return hosts.length > 0 ? hosts : undefined;
}
