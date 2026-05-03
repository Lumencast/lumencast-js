// Scenario YAML loader. Mirrors the Go reference at
// lumencast-go/conformance/scenario.go and the contract in
// lumencast-protocol/conformance/v1/SCENARIO-FORMAT.md.

import { parse as parseYaml } from "yaml";

export type Tag = "required" | "recommended" | "extended";
export type Target = "any" | "server" | "runtime";

export type StepKind =
  | "client-sends"
  | "server-sends"
  | "server-emits"
  | "expect-runtime-state"
  | "expect-server-state"
  | "expect-no-frame-for"
  | "expect-client-action";

export type ClientAction = "close-with-reason" | "reconnect";

export interface Step {
  kind: StepKind;
  /** client-sends, server-sends */
  frame?: Record<string, unknown>;
  /** expect-runtime-state, expect-server-state */
  state?: Record<string, unknown>;
  /** expect-no-frame-for */
  duration_ms?: number;
  /** expect-client-action */
  action?: ClientAction;
  reason?: string;
}

export interface BundleDecl {
  id: string;
  inline: Record<string, unknown>;
  /** sha256:<hex> — populated lazily by computeBundleHashes(). */
  hash?: string;
}

export interface Scenario {
  name: string;
  description: string;
  tag: Tag;
  target: Target;
  spec_refs?: string[];
  bundles?: BundleDecl[];
  steps: Step[];
}

export function parseScenario(raw: string): Scenario {
  const obj = parseYaml(raw) as Partial<Scenario> | undefined;
  if (!obj || typeof obj !== "object") {
    throw new Error("scenario: not a YAML mapping");
  }
  if (!obj.name) throw new Error("scenario: missing name");
  if (!Array.isArray(obj.steps)) throw new Error("scenario: missing steps[]");

  const tag: Tag = (obj.tag as Tag | undefined) ?? "required";
  const target: Target = (obj.target as Target | undefined) ?? "any";

  return {
    name: obj.name,
    description: obj.description ?? "",
    tag,
    target,
    ...(obj.spec_refs ? { spec_refs: obj.spec_refs } : {}),
    ...(obj.bundles ? { bundles: obj.bundles as BundleDecl[] } : {}),
    steps: obj.steps as Step[],
  };
}
