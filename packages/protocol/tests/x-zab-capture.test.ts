// RFC-0001 (+ Amendment 2) — `x-zab.capture` vendor primitive validation.

import { describe, expect, it } from "vitest";

import {
  CAPTURE_SOURCE_KINDS,
  CAPTURE_VISUAL_KINDS,
  checkZabCaptureNodes,
} from "../src/x-zab-capture.js";

const captureNode = (props: Record<string, unknown>): unknown => ({
  kind: "frame",
  children: [{ kind: "x-zab.capture", id: "cap", ...props }],
});

describe("x-zab.sourceKind enum (§A2.2)", () => {
  it("carries the nine normative kinds", () => {
    expect([...CAPTURE_SOURCE_KINDS].sort()).toEqual(
      [
        "media.app",
        "media.app_audio",
        "media.file",
        "media.game",
        "media.mic",
        "media.screen",
        "media.system_audio",
        "media.webcam",
        "media.window",
      ].sort(),
    );
  });

  it("the visual set is a SECOND set, and every member is a known kind (§A2.4)", () => {
    expect([...CAPTURE_VISUAL_KINDS].sort()).toEqual(
      [
        "media.app",
        "media.file",
        "media.game",
        "media.screen",
        "media.webcam",
        "media.window",
      ].sort(),
    );
    for (const k of CAPTURE_VISUAL_KINDS) expect(CAPTURE_SOURCE_KINDS.has(k)).toBe(true);
  });
});

describe("checkZabCaptureNodes", () => {
  it("accepts a visual kind with size", () => {
    expect(
      checkZabCaptureNodes(
        captureNode({
          "x-zab.sourceKind": "media.webcam",
          "x-zab.deviceRef": "primary-cam",
          size: { w: 640, h: 360 },
        }),
      ),
    ).toBeNull();
  });

  it("accepts an audio-only kind without size", () => {
    for (const kind of ["media.mic", "media.app_audio", "media.system_audio"]) {
      expect(
        checkZabCaptureNodes(
          captureNode({ "x-zab.sourceKind": kind, "x-zab.deviceRef": "desk-mic" }),
        ),
      ).toBeNull();
    }
  });

  it("rejects a physical-looking deviceRef", () => {
    for (const ref of ["video:0", "5e1c9f2a-0000-4000-8000-000000000000", "Primary", "0cam"]) {
      const err = checkZabCaptureNodes(
        captureNode({
          "x-zab.sourceKind": "media.webcam",
          "x-zab.deviceRef": ref,
          size: { w: 1, h: 1 },
        }),
      );
      expect(err, ref).toContain("x-zab.deviceRef");
      // The offending value is never echoed back — a physical id must not
      // travel further than the bundle that carried it.
      expect(err).not.toContain(ref);
    }
  });

  it("accepts the 64-char boundary and rejects 65", () => {
    const ok = "a" + "b".repeat(63);
    const tooLong = "a" + "b".repeat(64);
    const node = (ref: string): unknown =>
      captureNode({
        "x-zab.sourceKind": "media.mic",
        "x-zab.deviceRef": ref,
      });
    expect(checkZabCaptureNodes(node(ok))).toBeNull();
    expect(checkZabCaptureNodes(node(tooLong))).not.toBeNull();
  });

  it("rejects a visual kind without size — the §A2.4 trap", () => {
    for (const kind of ["media.file", "media.game", "media.webcam"]) {
      const err = checkZabCaptureNodes(
        captureNode({ "x-zab.sourceKind": kind, "x-zab.deviceRef": "intro-sting" }),
      );
      expect(err, kind).toContain("size");
    }
  });

  it("rejects an unknown sourceKind and a missing one", () => {
    expect(
      checkZabCaptureNodes(
        captureNode({ "x-zab.sourceKind": "media.hologram", "x-zab.deviceRef": "x" }),
      ),
    ).toContain("x-zab.sourceKind");
    expect(checkZabCaptureNodes(captureNode({ "x-zab.deviceRef": "x" }))).toContain(
      "x-zab.sourceKind",
    );
  });

  it("walks nested children and `template`, and ignores non-capture nodes", () => {
    expect(
      checkZabCaptureNodes({
        kind: "frame",
        children: [
          { kind: "text", id: "t" },
          {
            kind: "repeat",
            template: {
              kind: "x-zab.capture",
              id: "deep",
              "x-zab.sourceKind": "media.file",
              "x-zab.deviceRef": "intro-sting",
            },
          },
        ],
      }),
    ).toContain("size");
    expect(
      checkZabCaptureNodes({ kind: "frame", children: [{ kind: "image", id: "i" }] }),
    ).toBeNull();
  });
});
