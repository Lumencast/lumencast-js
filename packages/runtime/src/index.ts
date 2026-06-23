// Public surface of @lumencast/runtime.

export { mount } from "./mount.js";
export type {
  MountOptions,
  LumencastHandle,
  LumencastMode,
  LumencastStatus,
  LumencastToken,
  LumencastTokenProvider,
  LumencastError,
  LumencastMetric,
  LumencastDiagnostic,
  ErrorCode,
} from "./types.js";

// Anti-silent-drop diagnostics channel (ADR 001 §3.4, issue #34) —
// hosts that render outside `mount()` (embedding the tree directly,
// tooling, tests) can subscribe here ; `mount()` wires
// `MountOptions.onDiagnostic` to the same channel.
export {
  addDiagnosticsHandler,
  ANON_NODE_ID,
  type RenderDiagnostic,
  type DiagnosticHandler,
} from "./render/diagnostics.js";
export { PRIMITIVE_PROP_ALLOWLIST } from "./render/prop-allowlist.js";

// ADR 004 §A1.3 — host resolver type for the `x-zab.capture` ACQUIRE mode,
// supplied via `MountOptions.resolveCaptureDevice`. Exported so the consuming
// app (Prism/Solar) types its injected resolver against the runtime's contract.
export type { ResolveCaptureDevice } from "./render/primitives/capture.js";

// Bundle types are useful for hosts that want to typecheck pre-compiled scenes.
export type {
  RenderBundle,
  RenderNode,
  RenderKind,
  OperatorInput,
  ExternalAdapter,
  Asset,
  BundleUrlResolver,
} from "./render/bundle.js";

// Profile gating (LSML 1.1 §17.3.1 / §17.5.1) — exported so hosts and the
// compiler-side tooling can apply the same rule outside the fetch path, and
// so the runtime "publishes the list of profiles it supports" per §17.3.1.
export {
  SUPPORTED_PROFILES,
  BundleIncompatibleError,
  isAuthoringProfile,
  validateBundleProfiles,
} from "./render/bundle.js";

// Headless render (ADR 003) — render an already-compiled RenderBundle into a
// live DOM node, no WS, ready when layout + fonts settle. Hosts (Solar headless
// entry, ZabCanvas render worker, the zero-loss harness) screenshot the target
// once `ready` resolves. The runtime does DOM + readiness only — no fetch, no
// screenshot. Dynamically pulls BroadcastMode so it adds no eager weight to the
// `mount`/broadcast path (RC6).
export { renderBundleHeadless } from "./render/headless.js";
export type { HeadlessRenderOptions, HeadlessRenderHandle } from "./render/headless.js";

// Asset / font resolution helpers for headless hosts (ADR 003 §3.2). No-fetch:
// they only rewrite a bundle's `src`s against a caller table and load fonts
// from caller-supplied `data:` URIs. The host-allow gate stays the sole
// authority. (`FontFace` is the public type name per ADR 003 RC5; it is the
// spec object — distinct from the DOM `FontFace` constructor.)
export {
  resolveSrc,
  rewriteLayoutSrcs,
  rewriteDefaultsSrcs,
  injectFonts,
  type AssetTable,
  type FontFaceSpec,
  type FontFaceSpec as FontFace,
} from "./render/asset-resolve.js";
