// RFC-0001 / ADR 004 RC7 — conformance fixtures for `x-zab.capture`,
// compiled path.
//
// Same sibling-repo convention as profiles.test.ts : the scenarios live in
// the lumencast-protocol repo (conformance/v1/scenarios). The suite skips
// gracefully when that repo is not checked out next to this monorepo
// (override with LUMENCAST_PROTOCOL_REPO).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseScenario } from "@lumencast/protocol/conformance";
import { compileBundle, type LSMLBundle } from "../src/index.js";

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

const validLsml = loadInlineLsml("bundle-x-zab-capture-validates");
const audioLsml = loadInlineLsml("bundle-x-zab-capture-audio-no-size");
const badRefLsml = loadInlineLsml("bundle-x-zab-capture-bare-device-id-rejected");

describe.skipIf(!validLsml || !audioLsml || !badRefLsml)(
  "conformance — x-zab.capture fixtures through compileBundle (RC7)",
  () => {
    it("bundle-x-zab-capture-validates compiles transparently, no drop", () => {
      const out = compileBundle(validLsml!, {
        onWarn: () => {
          throw new Error("unexpected DROPPED_FIELD diagnostic");
        },
      });
      const cam = out.root.children?.[0];
      expect(cam?.kind).toBe("x-zab.capture");
      expect(cam?.props).toMatchObject({
        "x-zab.sourceKind": "media.webcam",
        "x-zab.deviceRef": "primary-cam",
        width: 640,
        height: 360,
      });
    });

    it("bundle-x-zab-capture-audio-no-size compiles (zero-area, no size)", () => {
      const out = compileBundle(audioLsml!);
      const mic = out.root.children?.[0];
      expect(mic?.props).toMatchObject({ "x-zab.sourceKind": "media.mic" });
      expect(mic?.props).not.toHaveProperty("width");
    });

    it("bundle-x-zab-capture-bare-device-id-rejected throws INVALID_VALUE", () => {
      expect(() => compileBundle(badRefLsml!)).toThrow(/x-zab\.deviceRef/);
    });
  },
);
