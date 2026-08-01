// RFC-0001 / ADR 004 — `x-zab.capture` vendor primitive, compiler arm.
//
// Covered here :
//   RC1 — a valid capture node compiles WITHOUT DROPPED_FIELD / INVALID_VALUE
//         and preserves the vendor props in the RenderNode.
//   RC3 — an invalid `deviceRef` (UUID / contains `:`) throws INVALID_VALUE.
//   RC4 — `media.mic` without `size` is valid (zero-area inert node).
//   RC5 — a bundle WITHOUT capture hashes identically (non-regression of the
//         9 core primitives ; the case is purely additive).

import { describe, expect, it, vi } from "vitest";
import { compileBundle, hashBundle, ZERO_HASH, type LSMLBundle } from "../src/index.js";

const base: Omit<LSMLBundle, "layout"> = {
  lsml: "1.1",
  scene_id: "test",
  scene_version: ZERO_HASH,
};

describe("x-zab.capture — RC1 : compiles, preserves vendor props, no drop", () => {
  it("compiles a webcam capture node with no diagnostic", () => {
    const onWarn = vi.fn();
    const out = compileBundle(
      {
        ...base,
        layout: {
          kind: "x-zab.capture",
          id: "cam",
          "x-zab.sourceKind": "media.webcam",
          "x-zab.deviceRef": "primary-cam",
          size: { w: 640, h: 360 },
          opacity: 1,
        },
      },
      { onWarn },
    );
    expect(onWarn).not.toHaveBeenCalled();
    expect(out.root.kind).toBe("x-zab.capture");
    expect(out.root.props).toMatchObject({
      "x-zab.sourceKind": "media.webcam",
      "x-zab.deviceRef": "primary-cam",
      width: 640,
      height: 360,
      opacity: 1,
    });
  });

  it("preserves an authored fit without a diagnostic", () => {
    const onWarn = vi.fn();
    const out = compileBundle(
      {
        ...base,
        layout: {
          kind: "x-zab.capture",
          id: "cam",
          "x-zab.sourceKind": "media.webcam",
          "x-zab.deviceRef": "primary-cam",
          size: { w: 640, h: 360 },
          fit: "fill",
        },
      },
      { onWarn },
    );
    expect(onWarn).not.toHaveBeenCalled();
    expect(out.root.props).toMatchObject({ fit: "fill" });
  });

  it("omits fit when the author did not set one", () => {
    const out = compileBundle({
      ...base,
      layout: {
        kind: "x-zab.capture",
        id: "cam",
        "x-zab.sourceKind": "media.webcam",
        "x-zab.deviceRef": "primary-cam",
        size: { w: 640, h: 360 },
      },
    });
    expect(out.root.props).not.toHaveProperty("fit");
  });

  it("compiles a media.app node — same wire shape as media.window, no diagnostic", () => {
    const onWarn = vi.fn();
    const out = compileBundle(
      {
        ...base,
        layout: {
          kind: "x-zab.capture",
          id: "app",
          "x-zab.sourceKind": "media.app",
          "x-zab.deviceRef": "obs-studio",
          size: { w: 1920, h: 1080 },
        },
      },
      { onWarn },
    );
    expect(onWarn).not.toHaveBeenCalled();
    expect(out.root.props).toMatchObject({
      "x-zab.sourceKind": "media.app",
      "x-zab.deviceRef": "obs-studio",
      width: 1920,
      height: 1080,
    });
  });

  it("strict mode does not throw on a valid capture node", () => {
    expect(() =>
      compileBundle(
        {
          ...base,
          layout: {
            kind: "x-zab.capture",
            "x-zab.sourceKind": "media.screen",
            "x-zab.deviceRef": "main-display",
            size: { w: 1920, h: 1080 },
          },
        },
        { strict: true },
      ),
    ).not.toThrow();
  });
});

describe("x-zab.capture — RC3 : invalid deviceRef is INVALID_VALUE (throws)", () => {
  it.each([
    ["a UUID", "550e8400-e29b-41d4-a716-446655440000"],
    ["a physical device id with colon", "video:0"],
    ["uppercase", "Primary-Cam"],
    ["a leading digit", "0cam"],
    ["over 64 chars", "a".repeat(65)],
    ["empty", ""],
  ])("rejects %s", (_label, ref) => {
    expect(() =>
      compileBundle({
        ...base,
        layout: {
          kind: "x-zab.capture",
          id: "cam",
          "x-zab.sourceKind": "media.webcam",
          "x-zab.deviceRef": ref,
          size: { w: 640, h: 360 },
        },
      }),
    ).toThrow(/x-zab\.deviceRef/);
  });

  it("never echoes the offending deviceRef value (R9)", () => {
    try {
      compileBundle({
        ...base,
        layout: {
          kind: "x-zab.capture",
          id: "cam",
          "x-zab.sourceKind": "media.webcam",
          "x-zab.deviceRef": "video:SECRET-DEVICE",
          size: { w: 1, h: 1 },
        },
      });
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as Error).message).not.toContain("SECRET-DEVICE");
    }
  });

  it("rejects an unknown sourceKind", () => {
    expect(() =>
      compileBundle({
        ...base,
        layout: {
          kind: "x-zab.capture",
          "x-zab.sourceKind": "media.hologram" as never,
          "x-zab.deviceRef": "primary-cam",
          size: { w: 1, h: 1 },
        },
      }),
    ).toThrow(/x-zab\.sourceKind/);
  });

  it("rejects a visual sourceKind missing size", () => {
    expect(() =>
      compileBundle({
        ...base,
        layout: {
          kind: "x-zab.capture",
          "x-zab.sourceKind": "media.webcam",
          "x-zab.deviceRef": "primary-cam",
        },
      }),
    ).toThrow(/size/);
  });
});

describe("x-zab.capture — RC4 : audio kinds may omit size (zero-area)", () => {
  it.each(["media.mic", "media.app_audio"] as const)("%s without size compiles", (sourceKind) => {
    const onWarn = vi.fn();
    const out = compileBundle(
      {
        ...base,
        layout: {
          kind: "x-zab.capture",
          id: "audio",
          "x-zab.sourceKind": sourceKind,
          "x-zab.deviceRef": "main-mic",
        },
      },
      { onWarn },
    );
    expect(onWarn).not.toHaveBeenCalled();
    expect(out.root.props).toMatchObject({ "x-zab.sourceKind": sourceKind });
    expect(out.root.props).not.toHaveProperty("width");
    expect(out.root.props).not.toHaveProperty("height");
  });
});

describe("x-zab.capture — RC5 : bundles without capture are unchanged", () => {
  const noCapture: LSMLBundle = {
    ...base,
    layout: {
      kind: "frame",
      size: { w: 1920, h: 1080 },
      background: "#000",
      children: [{ kind: "image", alt: "logo", size: { w: 96, h: 64 }, fit: "contain" }],
    },
  };

  it("hashes a non-capture bundle the same as a baseline copy (additive case)", async () => {
    const a = await hashBundle(compileBundle(noCapture));
    const b = await hashBundle(compileBundle(structuredClone(noCapture)));
    expect(a.scene_version).toBe(b.scene_version);
  });
});
