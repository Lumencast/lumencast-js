// Profile forwarding through the compiled path (ADR 001 §3.2.1, RC#1).
//
// The compiler must forward `profiles[]` verbatim into the RenderBundle so
// the runtime applies the same gating rule (§17.3.1 hard rejection for
// unsupported behavioural profiles, §17.5.1 advisory pass-through for
// authoring profiles) on the compiled path as on the direct-fetch path.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseScenario } from "@lumencast/protocol/conformance";
import { BundleIncompatibleError, validateBundleProfiles } from "@lumencast/runtime";
import { compileBundle, ZERO_HASH, type LSMLBundle } from "../src/index.js";

const minimalLsml: LSMLBundle = {
  lsml: "1.1",
  scene_id: "test",
  scene_version: ZERO_HASH,
  layout: { kind: "frame", size: { w: 100, h: 100 } },
};

describe("compileBundle — profiles[] forwarding (LSML §17.3)", () => {
  it("forwards profiles[] verbatim into the RenderBundle", () => {
    const out = compileBundle({
      ...minimalLsml,
      profiles: ["x-lumencast.color-srgb-1.0", "x-figma.authoring/1"],
    });
    expect(out.profiles).toEqual(["x-lumencast.color-srgb-1.0", "x-figma.authoring/1"]);
  });

  it("omits profiles when the LSML bundle declares none", () => {
    const out = compileBundle(minimalLsml);
    expect(out).not.toHaveProperty("profiles");
  });

  it("RC#1 compiled path: an authoring profile passes runtime validation", () => {
    const out = compileBundle({ ...minimalLsml, profiles: ["x-figma.authoring/1"] });
    expect(() => validateBundleProfiles(out)).not.toThrow();
  });

  it("RC#1 compiled path: an unknown behavioural profile rejects BUNDLE_INCOMPATIBLE", () => {
    const out = compileBundle({ ...minimalLsml, profiles: ["x-acme.broadcast/1.0"] });
    expect(() => validateBundleProfiles(out)).toThrow(BundleIncompatibleError);
  });
});

// --- conformance fixture, compiled path --------------------------------
//
// Same sibling-repo convention as packages/protocol/tests/conformance ;
// skips gracefully when lumencast-protocol is not checked out next to
// this monorepo. Override with LUMENCAST_PROTOCOL_REPO.

const PROTOCOL_REPO =
  process.env["LUMENCAST_PROTOCOL_REPO"] ??
  resolve(import.meta.dirname, "../../../..", "lumencast-protocol");

function loadInlineLsml(scenarioName: string): LSMLBundle | null {
  let raw: string;
  try {
    raw = readFileSync(
      resolve(PROTOCOL_REPO, "conformance/v1/scenarios", `${scenarioName}.yaml`),
      "utf8",
    );
  } catch {
    return null;
  }
  const bundle = parseScenario(raw).bundles?.[0]?.inline;
  if (!bundle) throw new Error(`scenario ${scenarioName}: no inline bundle`);
  return bundle as unknown as LSMLBundle;
}

const authoringLsml = loadInlineLsml("bundle-authoring-profile-ignored");
const rejectedLsml = loadInlineLsml("bundle-unsupported-profile-rejected");

describe.skipIf(!authoringLsml || !rejectedLsml)(
  "conformance — profile fixtures through compileBundle (RC#1)",
  () => {
    it("bundle-authoring-profile-ignored compiles and validates without rejection", () => {
      const out = compileBundle(authoringLsml!);
      expect(out.profiles).toEqual(["x-figma.authoring/1"]);
      expect(() => validateBundleProfiles(out)).not.toThrow();
    });

    it("bundle-unsupported-profile-rejected compiles then rejects BUNDLE_INCOMPATIBLE", () => {
      const out = compileBundle(rejectedLsml!);
      expect(() => validateBundleProfiles(out)).toThrow(BundleIncompatibleError);
    });
  },
);
