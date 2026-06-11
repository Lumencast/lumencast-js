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
