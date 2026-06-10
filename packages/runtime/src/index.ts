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
  ErrorCode,
} from "./types.js";

// Bundle types are useful for hosts that want to typecheck pre-compiled scenes.
export type {
  RenderBundle,
  RenderNode,
  RenderKind,
  OperatorInput,
  ExternalAdapter,
  Asset,
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
