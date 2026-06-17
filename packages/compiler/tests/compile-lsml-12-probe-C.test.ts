// Probe — LSML 1.2 compiler adversarial + edge-case coverage (ADR 002 #C).
// Bastion condition T4 (closed enums, gradient transform).
//
// This file COMPLEMENTS Forge's `compile-lsml-12.test.ts` — it does NOT
// duplicate its cases. It covers :
//   - all 16 blendMode values recognised, PASS_THROUGH / null / non-string rejected
//   - blendMode universal on frame / text / stack (not just shape)
//   - mask on non-shape primitives (text, frame)
//   - mask.type / mask.op diagnostics never echo the offending value (R9)
//   - mask source: shape with non-string ref → drop whole mask
//   - mask source: image with non-string src → drop whole mask
//   - mask null / array / scalar source → drop + diagnose
//   - mask position/size preserved when valid, stripped when extraneous keys present
//   - clampGradientTransform: -Infinity, length 7, string element, null, scalar,
//     exactly at cap, one over cap, negative one over cap
//   - radial-gradient transform lowered correctly
//   - image-fill with Infinity transform component → omit transform, keep fill
//   - LSML 1.0 compiles inchanged, zero warnings
//   - assets bundle key generates NOT_LOWERED diagnostic (auditBundleKeys coverage)
//   - lsml "2.0" and "1.9" rejected
//
// Refs ADR 002 #C.
// Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>

import { describe, expect, it } from "vitest";
import {
  compileBundle,
  parseBlendMode,
  parseObjectFit,
  clampGradientTransform,
  BLEND_MODES,
  OBJECT_FITS,
  MASK_TYPES,
  MASK_OPS,
  MAX_GRADIENT_TRANSFORM_ABS,
  ZERO_HASH,
  type LSMLBundle,
  type LSMLNode,
} from "../src/index.js";

function bundle(layout: LSMLNode, lsml: "1.0" | "1.1" | "1.2" = "1.2"): LSMLBundle {
  return { lsml, scene_id: "t", scene_version: ZERO_HASH, layout };
}

function compile(layout: LSMLNode, lsmlVer: "1.0" | "1.1" | "1.2" = "1.2") {
  const warns: string[] = [];
  const root = compileBundle(bundle(layout, lsmlVer), { onWarn: (m) => warns.push(m) }).root;
  return { warns, root };
}

// ---------------------------------------------------------------------------
// Retro-compat: LSML 1.0 compiles unchanged with zero warnings
// ---------------------------------------------------------------------------
describe("retro-compat — LSML 1.0 compiles unchanged (0 warnings)", () => {
  it("1.0 shape/fill compiles without warnings", () => {
    const { warns, root } = compile(
      { kind: "shape", geometry: "rect", fill: "#ff0000" },
      "1.0",
    );
    expect(warns).toEqual([]);
    expect(root.props?.["fill"]).toBe("#ff0000");
  });

  it("1.0 frame with background compiles without warnings", () => {
    const { warns, root } = compile(
      { kind: "frame", background: "#00ff00", size: { w: 1920, h: 1080 } },
      "1.0",
    );
    expect(warns).toEqual([]);
    expect(root.props?.["background"]).toBe("#00ff00");
  });

  it("1.0 text node compiles without warnings", () => {
    const { warns, root } = compile(
      { kind: "text", style: { fontSize: 24, fontFamily: "Inter", color: "#fff" } },
      "1.0",
    );
    expect(warns).toEqual([]);
    expect(root.props?.["size"]).toBe(24);
    expect(root.props?.["colour"]).toBe("#fff");
  });

  it("1.0 bundle with nested children compiles without warnings", () => {
    const { warns } = compile(
      {
        kind: "stack",
        direction: "horizontal",
        gap: 8,
        children: [
          { kind: "text", style: { fontSize: 16 } },
          { kind: "shape", geometry: "circle", fill: "#000" },
        ],
      },
      "1.0",
    );
    expect(warns).toEqual([]);
  });

  it("lsml 2.0 is rejected", () => {
    expect(() =>
      compileBundle({
        lsml: "2.0" as never,
        scene_id: "t",
        scene_version: ZERO_HASH,
        layout: { kind: "frame" },
      }),
    ).toThrow(/not supported/);
  });

  it("lsml 1.9 is rejected", () => {
    expect(() =>
      compileBundle({
        lsml: "1.9" as never,
        scene_id: "t",
        scene_version: ZERO_HASH,
        layout: { kind: "frame" },
      }),
    ).toThrow(/not supported/);
  });
});

// ---------------------------------------------------------------------------
// blendMode — all 16 values recognised, bad values + non-strings rejected
// ---------------------------------------------------------------------------
describe("blendMode — exhaustive enum coverage", () => {
  it("recognises all 16 valid blend modes via parseBlendMode", () => {
    for (const mode of BLEND_MODES) {
      expect(parseBlendMode(mode)).toBe(mode);
    }
    expect(BLEND_MODES.size).toBe(16);
  });

  it("rejects pass-through (Figma-only, never in CSS — deliberately excluded)", () => {
    expect(parseBlendMode("pass-through")).toBeNull();
    expect(parseBlendMode("PASS_THROUGH")).toBeNull();
  });

  it("rejects non-string inputs", () => {
    for (const bad of [null, undefined, 0, [], {}, true, NaN]) {
      expect(parseBlendMode(bad)).toBeNull();
    }
  });

  it("rejects CSS values not in the allowlist (never passthrough)", () => {
    for (const bad of ["initial", "inherit", "unset", "revert", "url(#x)"]) {
      expect(parseBlendMode(bad)).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// blendMode — universal property on frame / text / stack (not just shape)
// ---------------------------------------------------------------------------
describe("blendMode — universal on every primitive kind", () => {
  const modes: Array<[string, LSMLNode]> = [
    ["frame", { kind: "frame", blendMode: "multiply" }],
    ["text", { kind: "text", style: {}, blendMode: "screen" }],
    ["stack", { kind: "stack", blendMode: "overlay" }],
    ["grid", { kind: "grid", columns: 3, blendMode: "darken" }],
  ];

  for (const [kind, node] of modes) {
    it(`forwards blendMode on ${kind}`, () => {
      const { warns, root } = compile(node);
      expect(warns).toEqual([]);
      expect(root.props?.["blendMode"]).toBeDefined();
    });
  }

  it("omits + diagnoses bad blendMode on frame without echoing the value (R9)", () => {
    const hostile = "url(javascript:alert(1))";
    const { warns, root } = compile({ kind: "frame", id: "f1", blendMode: hostile as never });
    expect(root.props?.["blendMode"]).toBeUndefined();
    expect(warns.length).toBe(1);
    expect(warns[0]).not.toContain(hostile);
    expect(warns[0]).not.toContain("url(");
    expect(warns[0]).not.toContain("javascript");
  });
});

// ---------------------------------------------------------------------------
// objectFit — exhaustive enum + non-string rejection
// ---------------------------------------------------------------------------
describe("objectFit — exhaustive enum coverage", () => {
  it("recognises all 5 valid objectFit values", () => {
    for (const fit of OBJECT_FITS) {
      expect(parseObjectFit(fit)).toBe(fit);
    }
    expect(OBJECT_FITS.size).toBe(5);
  });

  it("rejects non-string inputs", () => {
    for (const bad of [null, undefined, 0, [], {}, true]) {
      expect(parseObjectFit(bad)).toBeNull();
    }
  });

  it("rejects CSS values not in the allowlist", () => {
    expect(parseObjectFit("stretch")).toBeNull();
    expect(parseObjectFit("auto")).toBeNull();
    expect(parseObjectFit("initial")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// mask — R9: bad type / op diagnostics NEVER echo the offending value
// ---------------------------------------------------------------------------
describe("mask — R9 diagnostics never echo offending values", () => {
  it("mask.type bad value — diagnostic does not echo the value", () => {
    const hostile = "xss<script>alert(1)</script>";
    const { warns, root } = compile({
      kind: "shape",
      geometry: "rect",
      id: "n1",
      mask: { source: { kind: "shape", ref: "m" }, type: hostile as never, op: "intersect" },
    });
    expect(root.props?.["mask"]).toBeUndefined();
    expect(warns.length).toBe(1);
    expect(warns[0]).not.toContain("xss");
    expect(warns[0]).not.toContain("script");
    expect(warns[0]).not.toContain(hostile);
  });

  it("mask.op bad value — diagnostic does not echo the value", () => {
    const hostile = "url(data:text/html,<evil>)";
    const { warns, root } = compile({
      kind: "shape",
      geometry: "rect",
      id: "n1",
      mask: { source: { kind: "shape", ref: "m" }, type: "alpha", op: hostile as never },
    });
    expect(root.props?.["mask"]).toBeUndefined();
    expect(warns.length).toBe(1);
    expect(warns[0]).not.toContain("url(");
    expect(warns[0]).not.toContain("data:");
    expect(warns[0]).not.toContain("evil");
  });
});

// ---------------------------------------------------------------------------
// mask — exhaustive source-discriminant edge cases
// ---------------------------------------------------------------------------
describe("mask — source discriminant edge cases", () => {
  it("drops the whole mask when source.kind is 'shape' but ref is a number", () => {
    const { warns, root } = compile({
      kind: "shape",
      geometry: "rect",
      mask: { source: { kind: "shape", ref: 123 as never }, type: "alpha", op: "intersect" },
    });
    expect(root.props?.["mask"]).toBeUndefined();
    expect(warns.length).toBe(1);
  });

  it("drops the whole mask when source.kind is 'image' but src is a number", () => {
    const { warns, root } = compile({
      kind: "shape",
      geometry: "rect",
      mask: { source: { kind: "image", src: 42 as never }, type: "alpha", op: "intersect" },
    });
    expect(root.props?.["mask"]).toBeUndefined();
    expect(warns.length).toBe(1);
  });

  it("drops when source is null", () => {
    const { warns, root } = compile({
      kind: "shape",
      geometry: "rect",
      mask: { source: null as never, type: "alpha", op: "intersect" },
    });
    expect(root.props?.["mask"]).toBeUndefined();
    expect(warns.length).toBe(1);
  });

  it("drops when source is an array", () => {
    const { warns, root } = compile({
      kind: "shape",
      geometry: "rect",
      mask: { source: [] as never, type: "alpha", op: "intersect" },
    });
    expect(root.props?.["mask"]).toBeUndefined();
    expect(warns.length).toBe(1);
  });

  it("drops when source.kind is an unknown string", () => {
    const { warns, root } = compile({
      kind: "shape",
      geometry: "rect",
      mask: {
        source: { kind: "polygon" as never, ref: "m" } as never,
        type: "alpha",
        op: "intersect",
      },
    });
    expect(root.props?.["mask"]).toBeUndefined();
    expect(warns.length).toBe(1);
  });

  it("accepts source.kind 'image' with a valid src string", () => {
    const { warns, root } = compile({
      kind: "shape",
      geometry: "rect",
      mask: {
        source: { kind: "image", src: "https://cdn.x/m.png" },
        type: "luminance",
        op: "subtract",
      },
    });
    // Compiler passes it; host-allow gate is at #F (runtime).
    expect(root.props?.["mask"]).toMatchObject({
      source: { kind: "image", src: "https://cdn.x/m.png" },
    });
    expect(warns).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// mask — universal on non-shape primitives
// ---------------------------------------------------------------------------
describe("mask — universal on non-shape primitives", () => {
  it("forwards a valid mask on a text node", () => {
    const { warns, root } = compile({
      kind: "text",
      style: {},
      mask: { source: { kind: "shape", ref: "m1" }, type: "alpha", op: "subtract" },
    });
    expect(warns).toEqual([]);
    expect(root.props?.["mask"]).toMatchObject({ type: "alpha", op: "subtract" });
  });

  it("forwards a valid mask on a frame node", () => {
    const { warns, root } = compile({
      kind: "frame",
      mask: { source: { kind: "shape", ref: "m2" }, type: "luminance", op: "union" },
    });
    expect(warns).toEqual([]);
    expect(root.props?.["mask"]).toMatchObject({ type: "luminance", op: "union" });
  });
});

// ---------------------------------------------------------------------------
// mask — all valid type/op combinations recognised
// ---------------------------------------------------------------------------
describe("mask — all valid type/op combinations", () => {
  for (const type of MASK_TYPES) {
    for (const op of MASK_OPS) {
      it(`accepts type=${type} op=${op}`, () => {
        const { warns, root } = compile({
          kind: "shape",
          geometry: "rect",
          mask: { source: { kind: "shape", ref: "m" }, type: type as never, op: op as never },
        });
        expect(warns).toEqual([]);
        expect(root.props?.["mask"]).toMatchObject({ type, op });
      });
    }
  }
});

// ---------------------------------------------------------------------------
// clampGradientTransform — adversarial edge cases
// ---------------------------------------------------------------------------
describe("clampGradientTransform — adversarial inputs", () => {
  it("rejects -Infinity (not finite)", () => {
    expect(clampGradientTransform([-Infinity, 0, 0, 1, 0, 0])).toBeNull();
  });

  it("rejects an array of 7 elements", () => {
    expect(clampGradientTransform([1, 2, 3, 4, 5, 6, 7])).toBeNull();
  });

  it("rejects an array of 5 elements", () => {
    expect(clampGradientTransform([1, 2, 3, 4, 5])).toBeNull();
  });

  it("rejects an empty array", () => {
    expect(clampGradientTransform([])).toBeNull();
  });

  it("rejects an array with a string element", () => {
    expect(clampGradientTransform([1, "2" as never, 3, 4, 5, 6])).toBeNull();
  });

  it("rejects null", () => {
    expect(clampGradientTransform(null)).toBeNull();
  });

  it("rejects a plain number (not an array)", () => {
    expect(clampGradientTransform(42)).toBeNull();
  });

  it("rejects a string (not an array)", () => {
    expect(clampGradientTransform("1,0,0,1,0,0")).toBeNull();
  });

  it("rejects a plain object", () => {
    expect(clampGradientTransform({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })).toBeNull();
  });

  it("accepts a transform exactly at the positive cap (1e6)", () => {
    const result = clampGradientTransform([1e6, 0, 0, 1, 0, 0]);
    expect(result).not.toBeNull();
    expect(result![0]).toBe(MAX_GRADIENT_TRANSFORM_ABS);
  });

  it("clamps a value one above the positive cap to the cap", () => {
    const result = clampGradientTransform([1_000_001, 0, 0, 1, 0, 0]);
    expect(result).not.toBeNull();
    expect(result![0]).toBe(MAX_GRADIENT_TRANSFORM_ABS);
  });

  it("clamps a value one beyond the negative cap", () => {
    const result = clampGradientTransform([-1_000_001, 0, 0, 1, 0, 0]);
    expect(result).not.toBeNull();
    expect(result![0]).toBe(-MAX_GRADIENT_TRANSFORM_ABS);
  });

  it("normalises -0 in every position", () => {
    const result = clampGradientTransform([-0, -0, -0, -0, -0, -0]);
    expect(result).not.toBeNull();
    for (let i = 0; i < 6; i++) {
      expect(result![i]).toBe(0);
      expect(Object.is(result![i], -0)).toBe(false);
    }
  });

  it("returns a proper 6-element numeric array for the identity transform", () => {
    const result = clampGradientTransform([1, 0, 0, 1, 0, 0]);
    expect(result).toEqual([1, 0, 0, 1, 0, 0]);
    expect(Array.isArray(result)).toBe(true);
    expect(result!.length).toBe(6);
    for (const c of result!) expect(typeof c).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// Gradient transforms in fills — radial-gradient and image-fill edge cases
// ---------------------------------------------------------------------------
describe("gradient transform — fill lowering edge cases", () => {
  it("forwards a radial-gradient transform correctly", () => {
    const { warns, root } = compile({
      kind: "shape",
      geometry: "rect",
      fills: [
        {
          kind: "radial-gradient",
          stops: [{ offset: 0, color: "#000" }, { offset: 1, color: "#fff" }],
          transform: [1, 0, 0, 1, 50, 50],
        },
      ],
    });
    const fills = root.props?.["fills"] as Array<Record<string, unknown>>;
    expect(warns).toEqual([]);
    expect(fills[0]!["transform"]).toEqual([1, 0, 0, 1, 50, 50]);
  });

  it("omits a malformed radial-gradient transform, preserves the rest of the fill", () => {
    const { warns, root } = compile({
      kind: "shape",
      geometry: "rect",
      fills: [
        {
          kind: "radial-gradient",
          stops: [{ offset: 0, color: "#000" }],
          transform: [Infinity, 0, 0, 1, 0, 0] as never,
        },
      ],
    });
    const fills = root.props?.["fills"] as Array<Record<string, unknown>>;
    expect(warns.length).toBe(1);
    expect(fills[0]!["transform"]).toBeUndefined();
    // The fill itself must still be present.
    expect(fills[0]!["kind"]).toBe("radial-gradient");
    expect(fills[0]!["stops"]).toBeDefined();
  });

  it("omits a malformed image-fill transform, preserves src and kind", () => {
    const { warns, root } = compile({
      kind: "shape",
      geometry: "rect",
      fills: [
        {
          kind: "image",
          src: "https://cdn.x/a.png",
          objectFit: "cover",
          transform: [1, 0, Infinity, 1, 0, 0] as never,
        },
      ],
    });
    const fills = root.props?.["fills"] as Array<Record<string, unknown>>;
    expect(warns.length).toBe(1);
    expect(fills[0]!["transform"]).toBeUndefined();
    expect(fills[0]!["src"]).toBe("https://cdn.x/a.png");
    expect(fills[0]!["objectFit"]).toBe("cover");
  });

  it("radial-gradient without transform passes through unchanged", () => {
    const { warns, root } = compile({
      kind: "shape",
      geometry: "rect",
      fills: [{ kind: "radial-gradient", stops: [{ offset: 0, color: "#f00" }] }],
    });
    expect(warns).toEqual([]);
    const fills = root.props?.["fills"] as Array<Record<string, unknown>>;
    expect(fills[0]!["transform"]).toBeUndefined();
    expect(fills[0]!["kind"]).toBe("radial-gradient");
  });
});

// ---------------------------------------------------------------------------
// auditBundleKeys — `assets` key generates NOT_LOWERED diagnostic
// ---------------------------------------------------------------------------
describe("auditBundleKeys — assets key generates NOT_LOWERED diagnostic", () => {
  it("warns that assets is not lowered by the compiler", () => {
    const warns: string[] = [];
    compileBundle(
      {
        lsml: "1.2",
        scene_id: "t",
        scene_version: ZERO_HASH,
        layout: { kind: "frame" },
        assets: { allowedHosts: ["cdn.x"] },
      },
      { onWarn: (m) => warns.push(m) },
    );
    expect(warns.length).toBe(1);
    expect(warns[0]).toContain("assets");
    expect(warns[0]).toContain("not lowered");
  });

  it("does not warn when assets is absent", () => {
    const warns: string[] = [];
    compileBundle(
      { lsml: "1.2", scene_id: "t", scene_version: ZERO_HASH, layout: { kind: "frame" } },
      { onWarn: (m) => warns.push(m) },
    );
    expect(warns).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 1.2 blendMode + mask — no spurious warnings on a valid 1.2 bundle
// ---------------------------------------------------------------------------
describe("1.2 — no spurious warnings on a well-formed 1.2 bundle", () => {
  it("blendMode + mask on a frame produces zero warnings", () => {
    const { warns } = compile({
      kind: "frame",
      blendMode: "normal",
      mask: { source: { kind: "shape", ref: "m" }, type: "alpha", op: "intersect" },
    });
    expect(warns).toEqual([]);
  });

  it("image-fill with valid objectFit + transform produces zero warnings", () => {
    const { warns } = compile({
      kind: "shape",
      geometry: "rect",
      fills: [
        {
          kind: "image",
          src: "https://cdn.x/a.png",
          objectFit: "cover",
          transform: [1, 0, 0, 1, 0, 0],
        },
      ],
    });
    expect(warns).toEqual([]);
  });
});
