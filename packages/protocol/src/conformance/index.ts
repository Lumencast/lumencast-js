// Public surface of @lumencast/protocol/conformance.
//
// Loaders + harness for the LSDP/1 conformance scenarios. Used by the
// `lumencast-js conformance` CLI and by interop matrix runs.

export {
  parseScenario,
  type Scenario,
  type Step,
  type StepKind,
  type Tag,
  type Target,
  type ClientAction,
  type BundleDecl,
} from "./scenario.js";

export { loadScenarios, type LoadOptions } from "./loader.js";
export { matchFrame, matchValue, type MatchError } from "./match.js";
export { substitute } from "./placeholders.js";
export { canonicalize, hashInlineBundle } from "./bundle-hash.js";
export {
  ControlClient,
  type SetupRequest,
  type SetupResponse,
  type StateResponse,
  type HealthResponse,
} from "./control-client.js";
export {
  Harness,
  type HarnessOptions,
  type Outcome,
  type ScenarioResult,
  type Report,
} from "./harness.js";
