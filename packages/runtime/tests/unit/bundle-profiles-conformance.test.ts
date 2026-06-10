// Conformance fixtures for profile gating (ADR 001 RC#1 / RC#14).
//
// Replays the inline bundles of the `bundle-authoring-profile-ignored` and
// `bundle-unsupported-profile-rejected` scenarios from the protocol repo
// against the runtime's profile validation — the direct-fetch path of the
// gating rule (LSML 1.1 §17.3.1 / §17.5.1).
//
// The protocol repo lives next to this monorepo (sibling directory) by
// convention, same as packages/protocol/tests/conformance. Override the
// path with LUMENCAST_PROTOCOL_REPO if needed. Skips gracefully when the
// repo is absent (the dedicated CI conformance job checks it out).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseScenario } from "@lumencast/protocol/conformance";
import { BundleIncompatibleError, validateBundleProfiles } from "../../src/render/bundle.js";

const PROTOCOL_REPO =
  process.env["LUMENCAST_PROTOCOL_REPO"] ??
  resolve(import.meta.dirname, "../../../../..", "lumencast-protocol");

const scenariosDir = resolve(PROTOCOL_REPO, "conformance/v1/scenarios");

function loadInlineBundle(scenarioName: string): { profiles?: string[] } | null {
  let raw: string;
  try {
    raw = readFileSync(resolve(scenariosDir, `${scenarioName}.yaml`), "utf8");
  } catch {
    return null;
  }
  const scenario = parseScenario(raw);
  const bundle = scenario.bundles?.[0]?.inline;
  if (!bundle) throw new Error(`scenario ${scenarioName}: no inline bundle`);
  return bundle as { profiles?: string[] };
}

const authoringBundle = loadInlineBundle("bundle-authoring-profile-ignored");
const rejectedBundle = loadInlineBundle("bundle-unsupported-profile-rejected");

describe.skipIf(!authoringBundle || !rejectedBundle)(
  "conformance — profile gating fixtures (LSML §17.3.1 / §17.5.1)",
  () => {
    it("bundle-authoring-profile-ignored: x-figma.authoring/1 validates without rejection", () => {
      expect(authoringBundle?.profiles).toContain("x-figma.authoring/1");
      expect(() => validateBundleProfiles(authoringBundle!)).not.toThrow();
    });

    it("bundle-unsupported-profile-rejected: behavioural profiles reject BUNDLE_INCOMPATIBLE", () => {
      expect(() => validateBundleProfiles(rejectedBundle!)).toThrow(BundleIncompatibleError);
    });
  },
);
