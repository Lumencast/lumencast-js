// Render-side host-allowlist context (LSML 1.2, ADR 002 #F ; Bastion T1/T2).
//
// The bundle's `assets.allowedHosts` lives at the bundle root, but the
// asset URLs that must be gated (`image` src, image-fill `src`) are read
// deep inside primitive components that never see the bundle. This context
// threads the allowlist from the render root down to those primitives so
// every `src` reaching the DOM passes `isHostAllowed(src, allowedHosts)`
// FIRST — closing the runtime arm of the double-gate (the compiler is the
// other arm) AND the latent 1.1 hole where `image.tsx` placed `src` with no
// host check at all.
//
// Deny-by-default : a primitive rendered outside any provider sees
// `undefined`, which `isHostAllowed` treats as "no allowlist → reject every
// remote host". There is no path by which a missing provider silently
// re-opens the gate.

import { createContext, useContext, type ReactNode } from "react";
import { checkHostAllowed } from "@lumencast/protocol";
import { emitDiagnostic } from "./diagnostics";

const AllowedHostsCtx = createContext<readonly string[] | undefined>(undefined);

/**
 * Gate an asset `src` against the host + scheme allowlist BEFORE it reaches
 * the DOM (Bastion T1/T2). Returns the `src` unchanged when allowed, or
 * `undefined` when rejected — in which case the caller MUST omit the asset
 * (never passthrough). On rejection an R9-clean diagnostic is emitted : it
 * carries only `{ nodeId, field, reason }`, never the URL itself.
 *
 * The decision is deny-by-default : an absent / empty `allowedHosts` rejects
 * every remote host (see `checkHostAllowed`). `undefined`/non-string `src`
 * resolves to `undefined` (absent asset) WITHOUT a diagnostic — that is a
 * primitive with no source, not a rejected one.
 */
export function gateSrc(
  src: unknown,
  allowedHosts: readonly string[] | undefined,
  field: string,
  nodeId?: string,
): string | undefined {
  if (typeof src !== "string" || src.length === 0) return undefined;
  const decision = checkHostAllowed(src, allowedHosts);
  if (decision.allowed) return src;
  emitDiagnostic(nodeId, field, decision.reason ?? "asset host/scheme rejected");
  return undefined;
}

/** Provide the bundle's `assets.allowedHosts` to the render subtree. Set
 *  once at the render root (each mode wraps `<Tree>` with it). */
export function AllowedHostsProvider({
  hosts,
  children,
}: {
  hosts: readonly string[] | undefined;
  children: ReactNode;
}) {
  return <AllowedHostsCtx.Provider value={hosts}>{children}</AllowedHostsCtx.Provider>;
}

/** Read the active host allowlist. `undefined` when no provider is mounted —
 *  which `isHostAllowed` treats as deny-by-default (never a passthrough). */
export function useAllowedHosts(): readonly string[] | undefined {
  return useContext(AllowedHostsCtx);
}
