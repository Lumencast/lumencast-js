// LSML 1.2 foundation (ADR 002 #C) — closed enums + bounded gradient
// transform + typed mask + first-class image-fill, with the anti-drop /
// diagnostic discipline of ADR 001 §3.4 (no value in any diagnostic, R9).
//
//   1. retro-compat — a 1.1 bundle still compiles unchanged ;
//   2. enums — `blendMode` / `objectFit` / `mask.type` / `mask.op` outside
//      the closed set are diagnosed + OMITTED, never passthrough ;
//   3. gradient transform — 6 finite floats, clamped ; malformed → omitted ;
//   4. mask — typed source discriminant ; free / untyped source dropped.

import { describe, expect, it } from "vitest";
import {
  compileBundle,
  clampGradientTransform,
  parseBlendMode,
  parseObjectFit,
  MAX_GRADIENT_TRANSFORM_ABS,
  ZERO_HASH,
  type LSMLBundle,
  type LSMLNode,
} from "../src/index.js";

function bundle(layout: LSMLNode, lsml: "1.0" | "1.1" | "1.2" = "1.2"): LSMLBundle {
  // ADR 002 #F — image-fill `src` is host/scheme-gated at lowering
  // (Bastion T1/T2). These fixtures use `cdn.x`, so the bundle declares it
  // in `assets.allowedHosts` ; deny-by-default rejection is proven by the
  // dedicated host-allow lowering suite, not here.
  return {
    lsml,
    scene_id: "t",
    scene_version: ZERO_HASH,
    layout,
    assets: { allowedHosts: ["cdn.x"] },
  };
}

function compile(layout: LSMLNode): {
  warns: string[];
  root: ReturnType<typeof compileBundle>["root"];
} {
  const warns: string[] = [];
  const root = compileBundle(bundle(layout), { onWarn: (m) => warns.push(m) }).root;
  return { warns, root };
}

describe("1.2 version acceptance + 1.1 retro-compat", () => {
  it("accepts a bundle declaring lsml 1.2", () => {
    expect(() => compileBundle(bundle({ kind: "frame" }, "1.2"))).not.toThrow();
  });

  it("still compiles a 1.1 bundle unchanged (no new warnings)", () => {
    const { warns, root } = (() => {
      const w: string[] = [];
      const r = compileBundle(
        {
          lsml: "1.1",
          scene_id: "t",
          scene_version: ZERO_HASH,
          layout: { kind: "shape", geometry: "rect", fill: "#fff" },
        },
        { onWarn: (m) => w.push(m) },
      ).root;
      return { warns: w, root: r };
    })();
    expect(warns).toEqual([]);
    expect(root.props?.["fill"]).toBe("#fff");
  });

  it("rejects a 2.x major bump", () => {
    expect(() =>
      compileBundle({
        lsml: "2.0" as never,
        scene_id: "t",
        scene_version: ZERO_HASH,
        layout: { kind: "frame" },
      }),
    ).toThrow(/not supported/);
  });
});

describe("blendMode — closed enum, omit on miss (T4)", () => {
  it("forwards a valid blend mode", () => {
    const { warns, root } = compile({ kind: "shape", geometry: "rect", blendMode: "hard-light" });
    expect(root.props?.["blendMode"]).toBe("hard-light");
    expect(warns).toEqual([]);
  });

  it("omits + diagnoses an out-of-enum value, never passthrough", () => {
    const { warns, root } = compile({
      kind: "shape",
      geometry: "rect",
      id: "n1",
      // a CSS-injection-ish value must never reach props
      blendMode: "url(#x);color:red" as never,
    });
    expect(root.props?.["blendMode"]).toBeUndefined();
    expect(warns.length).toBe(1);
    // R9 — the rejected value is never echoed in the diagnostic
    expect(warns[0]).not.toContain("url(");
    expect(warns[0]).not.toContain("color:red");
  });

  it("rejects PASS_THROUGH (deliberately excluded)", () => {
    expect(parseBlendMode("pass-through")).toBeNull();
    expect(parseBlendMode("normal")).toBe("normal");
  });
});

describe("image-fill — first-class fill + objectFit enum (T4)", () => {
  it("forwards an image fill with a valid objectFit", () => {
    const { warns, root } = compile({
      kind: "shape",
      geometry: "rect",
      fills: [{ kind: "image", src: "https://cdn.x/a.png", objectFit: "cover" }],
    });
    const fills = root.props?.["fills"] as Array<Record<string, unknown>>;
    expect(fills[0]).toMatchObject({
      kind: "image",
      src: "https://cdn.x/a.png",
      objectFit: "cover",
    });
    expect(warns).toEqual([]);
  });

  it("omits a bad objectFit but keeps the rest of the fill", () => {
    const { warns, root } = compile({
      kind: "shape",
      geometry: "rect",
      id: "img1",
      fills: [{ kind: "image", src: "https://cdn.x/a.png", objectFit: "weird" as never }],
    });
    const fills = root.props?.["fills"] as Array<Record<string, unknown>>;
    expect(fills[0]["objectFit"]).toBeUndefined();
    expect(fills[0]["src"]).toBe("https://cdn.x/a.png");
    expect(warns.length).toBe(1);
    expect(warns[0]).not.toContain("weird");
  });

  it("validates image fills on frame backgrounds too", () => {
    const { warns } = compile({
      kind: "frame",
      backgrounds: [{ kind: "image", src: "https://cdn.x/bg.png", objectFit: "nope" as never }],
    });
    expect(warns.length).toBe(1);
  });
});

describe("gradient transform — 6 finite bounded floats (T4)", () => {
  it("forwards a valid transform on a linear gradient", () => {
    const { warns, root } = compile({
      kind: "shape",
      geometry: "rect",
      fills: [
        {
          kind: "linear-gradient",
          stops: [{ offset: 0, color: "#000" }],
          transform: [1, 0, 0, 1, 0, 0],
        },
      ],
    });
    const fills = root.props?.["fills"] as Array<Record<string, unknown>>;
    expect(fills[0]["transform"]).toEqual([1, 0, 0, 1, 0, 0]);
    expect(warns).toEqual([]);
  });

  it("drops a malformed transform (wrong arity) and diagnoses", () => {
    const { warns, root } = compile({
      kind: "shape",
      geometry: "rect",
      fills: [
        {
          kind: "linear-gradient",
          stops: [{ offset: 0, color: "#000" }],
          transform: [1, 0, 0] as never,
        },
      ],
    });
    const fills = root.props?.["fills"] as Array<Record<string, unknown>>;
    expect(fills[0]["transform"]).toBeUndefined();
    expect(warns.length).toBe(1);
  });

  it("clampGradientTransform clamps, normalises -0, rejects non-finite", () => {
    expect(clampGradientTransform([1, 2, 3, 4, 5, 6])).toEqual([1, 2, 3, 4, 5, 6]);
    expect(clampGradientTransform([1e12, 0, 0, 1, 0, 0])).toEqual([
      MAX_GRADIENT_TRANSFORM_ABS,
      0,
      0,
      1,
      0,
      0,
    ]);
    expect(clampGradientTransform([-0, 0, 0, 0, 0, 0])![0]).toBe(0);
    expect(Object.is(clampGradientTransform([-0, 0, 0, 0, 0, 0])![0], -0)).toBe(false);
    expect(clampGradientTransform([NaN, 0, 0, 0, 0, 0])).toBeNull();
    expect(clampGradientTransform([Infinity, 0, 0, 0, 0, 0])).toBeNull();
    expect(clampGradientTransform([1, 2, 3, 4, 5])).toBeNull();
    expect(clampGradientTransform("1,0,0,1,0,0")).toBeNull();
  });
});

describe("mask — typed fields only, never a free SVG string (T3/T4)", () => {
  it("forwards a valid alpha/intersect mask with a shape source", () => {
    const { warns, root } = compile({
      kind: "shape",
      geometry: "rect",
      mask: { source: { kind: "shape", ref: "m1" }, type: "alpha", op: "intersect" },
    });
    expect(root.props?.["mask"]).toMatchObject({
      source: { kind: "shape", ref: "m1" },
      type: "alpha",
      op: "intersect",
    });
    expect(warns).toEqual([]);
  });

  it("accepts an image source (re-gated by host-allow at #F)", () => {
    const { root } = compile({
      kind: "shape",
      geometry: "rect",
      mask: {
        source: { kind: "image", src: "https://cdn.x/m.png" },
        type: "luminance",
        op: "union",
      },
    });
    expect(root.props?.["mask"]).toMatchObject({
      source: { kind: "image", src: "https://cdn.x/m.png" },
    });
  });

  it("drops the whole mask on a bad type / op", () => {
    const t = compile({
      kind: "shape",
      geometry: "rect",
      mask: { source: { kind: "shape", ref: "m" }, type: "weird" as never, op: "intersect" },
    });
    expect(t.root.props?.["mask"]).toBeUndefined();
    expect(t.warns.length).toBe(1);

    const o = compile({
      kind: "shape",
      geometry: "rect",
      mask: { source: { kind: "shape", ref: "m" }, type: "alpha", op: "xor" as never },
    });
    expect(o.root.props?.["mask"]).toBeUndefined();
    expect(o.warns.length).toBe(1);
  });

  it("drops a mask whose source is not a typed discriminant", () => {
    const { warns, root } = compile({
      kind: "shape",
      geometry: "rect",
      mask: { source: "<svg>...</svg>" as never, type: "alpha", op: "intersect" },
    });
    expect(root.props?.["mask"]).toBeUndefined();
    expect(warns.length).toBe(1);
  });

  it("strips extraneous keys, keeping only typed mask fields", () => {
    const { root } = compile({
      kind: "shape",
      geometry: "rect",
      mask: {
        source: { kind: "shape", ref: "m" },
        type: "alpha",
        op: "intersect",
        // @ts-expect-error — extraneous key must not be forwarded
        evil: "<script>",
      },
    });
    const mask = root.props?.["mask"] as Record<string, unknown>;
    expect(mask["evil"]).toBeUndefined();
  });
});

describe("parseObjectFit — closed enum", () => {
  it("accepts the enum, rejects the rest", () => {
    for (const f of ["cover", "contain", "fill", "none", "scale-down"]) {
      expect(parseObjectFit(f)).toBe(f);
    }
    expect(parseObjectFit("squish")).toBeNull();
    expect(parseObjectFit(123)).toBeNull();
  });
});
