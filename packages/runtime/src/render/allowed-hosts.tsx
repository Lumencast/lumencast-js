// Render-side host-allowlist context (LSML 1.2, ADR 002 #E + #F ; Bastion T1/T2).
//
// CANONICAL host-gate module for the runtime. There is exactly ONE
// `AllowedHostsProvider` and ONE allowlist context for the whole render
// tree. The bundle's `assets.allowedHosts` rides this context from the
// render root down to every consumer that places an untrusted asset URL
// into the DOM :
//
//   - image-fill `src` on frame / shape backgrounds (#F, via `gateImageFills`
//     / `gateSrc` in `fill.tsx`),
//   - the `<img src>` of the `image` primitive (#F — closes the latent 1.1
//     hole where `image.tsx` placed `src` with no host check at all),
//   - a `mask.source`-image `href` (#E, via `checkHostAllowed` in
//     `mask.tsx`, which reads the allowlist off this same context through
//     `tree.tsx`).
//
// The underlying decision is ALWAYS delegated to `@lumencast/protocol`'s
// `checkHostAllowed` / `isHostAllowed` (the #C foundation, single source of
// truth for host + scheme matching). This module never re-implements that
// logic ; it only threads the allowlist and adapts it for each call-site.
//
// Deny-by-default : a consumer rendered outside any provider, or one whose
// bundle declares no `allowedHosts`, sees `undefined` — which
// `checkHostAllowed` treats as "no allowlist → reject every remote host".
// There is no path by which a missing provider silently re-opens the gate.
//
// The context value is a read-only, mount-stable `string[] | undefined`
// (the allowlist is part of the content-addressed bundle), so a plain React
// context is the right tool.

import { createContext, useContext, type ReactNode } from "react";
import { checkHostAllowed } from "@lumencast/protocol";
import { emitDiagnostic } from "./diagnostics";

const AllowedHostsCtx = createContext<readonly string[] | undefined>(undefined);

/**
 * Provide the bundle's host allowlist to the render subtree. Mounted ONCE at
 * the render root by each mode (broadcast / control / test), wrapping
 * `<Tree>`. The value should come from {@link readAllowedHosts} so the
 * legacy `Asset[]` and the LSML 1.2 object `assets` shapes are both handled
 * and non-string entries are dropped.
 *
 * Prop name is `hosts` (the canonical render-side spelling, #F).
 */
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
 *  which `checkHostAllowed` treats as deny-by-default (never a passthrough). */
export function useAllowedHosts(): readonly string[] | undefined {
  return useContext(AllowedHostsCtx);
}

/** Read `assets.allowedHosts` defensively off a render bundle, for the mode
 *  that provides the context. The LSML 1.2 compiler forwards `assets` in the
 *  object form `{ allowedHosts?: string[] }` (see `RenderBundle.assets`) ;
 *  a legacy bundle may still carry the old `Asset[]` form. Either way we
 *  extract a `string[]` of hostnames, or `undefined` (deny-by-default). A
 *  non-string entry is dropped — it can never match `new URL().hostname`. */
export function readAllowedHosts(bundle: { assets?: unknown }): readonly string[] | undefined {
  const assets = bundle.assets as { allowedHosts?: unknown } | undefined;
  const list = assets?.allowedHosts;
  if (!Array.isArray(list)) return undefined;
  const hosts = list.filter((h): h is string => typeof h === "string");
  return hosts.length > 0 ? hosts : undefined;
}

/**
 * Gate an asset `src` against the host + scheme allowlist BEFORE it reaches
 * the DOM (Bastion T1/T2). Returns the `src` unchanged when allowed, or
 * `undefined` when rejected — in which case the caller MUST omit the asset
 * (never passthrough). On rejection an R9-clean diagnostic is emitted : it
 * carries only `{ nodeId, field, reason }`, never the URL itself.
 *
 * The decision is delegated to `checkHostAllowed` and is deny-by-default :
 * an absent / empty `allowedHosts` rejects every remote host.
 * `undefined`/non-string/empty `src` resolves to `undefined` (absent asset)
 * WITHOUT a diagnostic — that is a primitive with no source, not a rejected
 * one.
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
