// Issue #29 — complete LSML 1.1 lowering (ADR 001 §3.2.2 D2, §3.4 D4,
// §5.1 R8/R9, §6 RC#2/RC#10).
//
// Three concern groups :
//   1. forwarding — every 1.1 field spec'd for shape/frame/repeat/animate
//      lands on the RenderNode under the prop name the runtime reads ;
//   2. security gates — compile-side SVG path allowlist + caps (RC#10)
//      and hard filter clamps (R8), with R9 hygiene (no value in any
//      diagnostic or error message) ;
//   3. anti-silent-drop — spec'd-but-not-yet-lowered fields (phase B)
//      produce an `onWarn` diagnostic, and `strict: true` throws.

import { describe, expect, it } from "vitest";
import {
  compileBundle,
  validatePathData,
  MAX_FILTER_BLUR_PX,
  MAX_FILTER_BRIGHTNESS,
  MAX_PATH_SUBPATHS,
  ZERO_HASH,
  type LSMLBundle,
  type LSMLNode,
} from "../src/index.js";

function bundle(layout: LSMLNode): LSMLBundle {
  return { lsml: "1.1", scene_id: "t", scene_version: ZERO_HASH, layout };
}

function collectWarns(layout: LSMLNode): {
  warns: string[];
  root: ReturnType<typeof compileBundle>["root"];
} {
  const warns: string[] = [];
  const out = compileBundle(bundle(layout), { onWarn: (m) => warns.push(m) });
  return { warns, root: out.root };
}

// ─── 1. forwarding ───────────────────────────────────────────────────

describe("shape lowering (LSML §4.6 + §4.12)", () => {
  const fills = [
    {
      kind: "linear-gradient" as const,
      angle_deg: 90,
      stops: [
        { offset: 0, color: "#ff7e00" },
        { offset: 1, color: "#ff1a3d" },
      ],
    },
    { kind: "solid" as const, color: "#00000033" },
  ];

  it("forwards fills[] and strokes[] verbatim", () => {
    const { root } = collectWarns({
      kind: "shape",
      geometry: "rect",
      size: { w: 200, h: 50 },
      fills,
      strokes: [{ color: "#ffffff", width: 1 }],
    });
    expect(root.props?.fills).toEqual(fills);
    expect(root.props?.strokes).toEqual([{ color: "#ffffff", width: 1 }]);
  });

  it("lowers the single stroke to the flat shape.tsx props (stroke / stroke_width)", () => {
    const { root } = collectWarns({
      kind: "shape",
      geometry: "rect",
      size: { w: 10, h: 10 },
      stroke: { color: "#000", width: 2 },
    });
    expect(root.props?.stroke).toBe("#000");
    expect(root.props?.stroke_width).toBe(2);
  });

  it("lowers cornerRadius to the canonical `radius` prop (shape.tsx reads radius)", () => {
    const { root } = collectWarns({
      kind: "shape",
      geometry: "rect",
      size: { w: 10, h: 10 },
      cornerRadius: 8,
    });
    expect(root.props?.radius).toBe(8);
    expect(root.props?.cornerRadius).toBeUndefined();
  });

  it("forwards paths[] with per-subpath winding rules", () => {
    const { root } = collectWarns({
      kind: "shape",
      geometry: "path",
      size: { w: 120, h: 80 },
      paths: [
        { data: "M0,0 L120,0 L120,80 L0,80 Z", windingRule: "NONZERO" },
        { data: "M30,20 L90,20 L90,60 L30,60 Z", windingRule: "EVENODD" },
      ],
    });
    expect(root.props?.paths).toEqual([
      { data: "M0,0 L120,0 L120,80 L0,80 Z", windingRule: "NONZERO" },
      { data: "M30,20 L90,20 L90,60 L30,60 Z", windingRule: "EVENODD" },
    ]);
  });

  it("forwards a valid pathData string", () => {
    const { root } = collectWarns({
      kind: "shape",
      geometry: "path",
      pathData: "M0,0 C10,10 20,10 30,0 Z",
    });
    expect(root.props?.pathData).toBe("M0,0 C10,10 20,10 30,0 Z");
  });

  it("warns when pathData and paths[] are both present (§4.6 mutual exclusion)", () => {
    const { warns } = collectWarns({
      kind: "shape",
      id: "both",
      geometry: "path",
      pathData: "M0,0 L1,1 Z",
      paths: [{ data: "M0,0 L2,2 Z" }],
    });
    expect(warns.some((w) => w.includes('"both"') && w.includes("pathData"))).toBe(true);
  });
});

describe("frame lowering (LSML §4.3)", () => {
  it("forwards backgrounds[] and clipsContent", () => {
    const backgrounds = [
      {
        kind: "linear-gradient" as const,
        angle_deg: 180,
        stops: [
          { offset: 0, color: "#1a1a2e" },
          { offset: 1, color: "#000000" },
        ],
      },
    ];
    const { root } = collectWarns({
      kind: "frame",
      size: { w: 100, h: 100 },
      backgrounds,
      clipsContent: false,
    });
    expect(root.props?.backgrounds).toEqual(backgrounds);
    expect(root.props?.clipsContent).toBe(false);
  });

  it("omits clipsContent when absent (the spec default is runtime-side)", () => {
    const { root } = collectWarns({ kind: "frame", size: { w: 1, h: 1 } });
    expect(root.props && "clipsContent" in root.props).toBe(false);
  });
});

describe("animate lowering (LSML §6.1)", () => {
  it("lowers per-axis scale [sx, sy] to scaleX / scaleY (no collapse)", () => {
    const { root } = collectWarns({
      kind: "frame",
      size: { w: 10, h: 10 },
      animate: {
        transition: { duration: 100 },
        transform: { scale: [1, 1] },
        from: { transform: { scale: [0.5, 2] } },
      },
    });
    expect(root.animate_initial).toEqual({ scaleX: 0.5, scaleY: 2 });
    expect(root.transitions).toHaveProperty("scaleX");
    expect(root.transitions).toHaveProperty("scaleY");
    expect(root.transitions).not.toHaveProperty("scale");
  });

  it("keeps scalar scale on the uniform `scale` key", () => {
    const { root } = collectWarns({
      kind: "frame",
      size: { w: 10, h: 10 },
      animate: {
        transition: { duration: 100 },
        transform: { scale: 1 },
        from: { transform: { scale: 0.8 } },
      },
    });
    expect(root.animate_initial).toEqual({ scale: 0.8 });
    expect(root.transitions).toHaveProperty("scale");
  });

  it("lowers animate.from.filter to a clamped CSS filter string (previously dropped)", () => {
    const { root, warns } = collectWarns({
      kind: "frame",
      size: { w: 10, h: 10 },
      animate: {
        transition: { duration: 100 },
        filter: { blur: 0, brightness: 1 },
        from: { filter: { blur: 4, brightness: 1.2 } },
      },
    });
    expect(root.animate_initial?.filter).toBe("blur(4px) brightness(1.2)");
    expect(root.transitions).toHaveProperty("filter");
    expect(warns).toEqual([]);
  });
});

describe("keyframes lowering (LSML §6.6) + stagger (§6.7)", () => {
  it("lowers a full sequence to the runtime Keyframes shape", () => {
    const { root, warns } = collectWarns({
      kind: "frame",
      size: { w: 10, h: 10 },
      keyframes: {
        key: "ui.modal.open",
        steps: [
          { at: 0, transform: { scale: 0.8, translate: [10, -5] }, opacity: 0 },
          { at: 0.6, transform: { scale: 1.05 }, opacity: 1, filter: { blur: 2 } },
          { at: 1, transform: { scale: 1, rotate: 0 } },
        ],
        duration_ms: 300,
        easing: "ease-out",
      },
    });
    expect(warns).toEqual([]);
    expect(root.keyframes).toEqual({
      key: "ui.modal.open",
      steps: [
        { at: 0, opacity: 0, transform: { scale: 0.8, translateX: 10, translateY: -5 } },
        { at: 0.6, opacity: 1, filter: "blur(2px) brightness(1)", transform: { scale: 1.05 } },
        { at: 1, transform: { scale: 1, rotate: 0 } },
      ],
      duration_ms: 300,
      easing: "ease-out",
    });
  });

  it("degrades per-axis step scale to sx WITH a diagnostic (never silently)", () => {
    const { root, warns } = collectWarns({
      kind: "frame",
      id: "kf",
      size: { w: 10, h: 10 },
      keyframes: {
        steps: [
          { at: 0, transform: { scale: [0.5, 0.7] } },
          { at: 1, transform: { scale: 1 } },
        ],
        duration_ms: 100,
      },
    });
    expect(root.keyframes?.steps[0]?.transform?.scale).toBe(0.5);
    expect(warns.some((w) => w.includes('"kf"') && w.includes("transform.scale"))).toBe(true);
  });

  it("forwards repeat.stagger_ms to RenderNode.stagger_ms", () => {
    const { root } = collectWarns({
      kind: "repeat",
      scope: "p",
      bind: { items: "players" },
      stagger_ms: 80,
      template: { kind: "text", bind: { value: "{p}.name" } },
    });
    expect(root.stagger_ms).toBe(80);
  });

  it("rejects a negative stagger_ms", () => {
    expect(() =>
      compileBundle(
        bundle({
          kind: "repeat",
          scope: "p",
          bind: { items: "players" },
          stagger_ms: -1,
          template: { kind: "text", bind: { value: "{p}.name" } },
        }),
      ),
    ).toThrow(/stagger_ms/);
  });
});

// ─── 2. security gates ───────────────────────────────────────────────

describe("filter hard clamps (Bastion R8 — ADR 001 §5.1)", () => {
  function compileFilter(filter: { blur?: number; brightness?: number }, warns: string[] = []) {
    const out = compileBundle(
      bundle({
        kind: "frame",
        id: "f",
        size: { w: 1, h: 1 },
        animate: { transition: { duration: 100 }, opacity: 1, from: { filter } },
      }),
      { onWarn: (m) => warns.push(m) },
    );
    return out.root.animate_initial?.filter;
  }

  it("rejects negative blur", () => {
    expect(() => compileFilter({ blur: -1 })).toThrow(/blur/);
  });

  it("rejects negative brightness", () => {
    expect(() => compileFilter({ brightness: -0.5 })).toThrow(/brightness/);
  });

  it("rejects non-finite values", () => {
    expect(() => compileFilter({ blur: Number.NaN })).toThrow(/blur/);
    expect(() => compileFilter({ brightness: Number.POSITIVE_INFINITY })).toThrow(/brightness/);
  });

  it(`caps blur at ${MAX_FILTER_BLUR_PX}px and diagnoses the clamp`, () => {
    const warns: string[] = [];
    expect(compileFilter({ blur: 99999 }, warns)).toBe(
      `blur(${MAX_FILTER_BLUR_PX}px) brightness(1)`,
    );
    expect(warns.some((w) => w.includes("blur") && w.includes("clamped"))).toBe(true);
  });

  it(`caps brightness at ${MAX_FILTER_BRIGHTNESS} and diagnoses the clamp`, () => {
    const warns: string[] = [];
    expect(compileFilter({ brightness: 10 }, warns)).toBe(
      `blur(0px) brightness(${MAX_FILTER_BRIGHTNESS})`,
    );
    expect(warns.some((w) => w.includes("brightness") && w.includes("clamped"))).toBe(true);
  });

  it("R9 — clamp diagnostics and reject errors never echo the value", () => {
    const warns: string[] = [];
    compileFilter({ blur: 31337 }, warns);
    expect(warns.join(" ")).not.toContain("31337");
    let message = "";
    try {
      compileFilter({ blur: -777 });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).not.toContain("777");
    expect(message).toContain('"f"'); // node id IS present
  });

  it("clamps keyframe step filters too (same gate)", () => {
    const { root } = collectWarns({
      kind: "frame",
      size: { w: 1, h: 1 },
      keyframes: {
        steps: [
          { at: 0, filter: { blur: 5000, brightness: 9 } },
          { at: 1, filter: { blur: 0 } },
        ],
        duration_ms: 100,
      },
    });
    expect(root.keyframes?.steps[0]?.filter).toBe(
      `blur(${MAX_FILTER_BLUR_PX}px) brightness(${MAX_FILTER_BRIGHTNESS})`,
    );
  });
});

describe("SVG path allowlist + caps (Bastion RC#10 — compile gate)", () => {
  it("accepts every command letter and exponent-form numbers", () => {
    expect(() =>
      validatePathData(
        "M0,0 m1,1 L2,2 l1,1 H5 h1 V5 v1 C1,2 3,4 5,6 c1,1 2,2 3,3 " +
          "S1,2 3,4 s1,2 3,4 Q1,2 3,4 q1,2 3,4 T5,6 t1,2 A1,1 0 0 1 5,5 a1,1 0 0 1 1,1 Z z " +
          "M1e3,2.5E-2 L-3.5,+4 Z",
        "n",
        "pathData",
      ),
    ).not.toThrow();
  });

  it.each([
    ["url(", "M0,0 url(http://evil) Z"],
    ["data:", "M0,0 data:text/html Z"],
    ["<", "M0,0 <script> Z"],
    ["&", "M0,0 &amp; Z"],
    ["bare letters", "M0,0 javascript Z"],
    ["bare exponent", "M0,0 e9 Z"],
    ["parens", "M0,0 (1,2) Z"],
  ])("rejects %s payloads", (_label, d) => {
    expect(() => validatePathData(d, "n", "pathData")).toThrow(/allowlist|RC#10/);
  });

  it("rejects an empty / command-less d", () => {
    expect(() => validatePathData("", "n", "pathData")).toThrow();
    expect(() => validatePathData("1,2 3,4", "n", "pathData")).toThrow(/command/);
  });

  it("caps subpath size at 8 KiB", () => {
    const big = "M0,0 " + "L1,1 ".repeat(2000); // > 8192 chars
    expect(big.length).toBeGreaterThan(8192);
    expect(() => validatePathData(big, "n", "pathData")).toThrow(/8192/);
  });

  it("caps the command count per subpath (under the byte cap)", () => {
    const many = "M0,0 " + "Z".repeat(5000); // 5005 bytes < 8 KiB, 5001 commands > cap
    expect(many.length).toBeLessThan(8192);
    expect(() => validatePathData(many, "n", "pathData")).toThrow(/command subpath cap/);
  });

  it(`caps the number of subpaths at ${MAX_PATH_SUBPATHS}`, () => {
    const paths = Array.from({ length: MAX_PATH_SUBPATHS + 1 }, () => ({ data: "M0,0 L1,1 Z" }));
    expect(() => compileBundle(bundle({ kind: "shape", geometry: "path", paths }))).toThrow(
      /subpath cap/,
    );
  });

  it("rejects a hostile pathData on a compiled shape (node id in the error, value absent)", () => {
    let message = "";
    try {
      compileBundle(
        bundle({ kind: "shape", id: "hostile", geometry: "path", pathData: "M0,0 url(x) Z" }),
      );
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('"hostile"');
    expect(message).not.toContain("url(x)");
  });

  it("validates every paths[].data entry", () => {
    expect(() =>
      compileBundle(
        bundle({
          kind: "shape",
          geometry: "path",
          paths: [{ data: "M0,0 L1,1 Z" }, { data: "M0,0 data:x Z" }],
        }),
      ),
    ).toThrow(/paths\[1\]\.data/);
  });

  it("is linear-time on adversarial input (no freeze — RC#12 spirit)", () => {
    const d = ("M0,0 " + "L1,1 ".repeat(1300)).slice(0, 8000) + "Z";
    const start = performance.now();
    for (let i = 0; i < 100; i++) validatePathData(d, "n", "pathData");
    const perCall = (performance.now() - start) / 100;
    expect(perCall).toBeLessThan(1); // ≤ 1 ms per max-size value
  });
});

// ─── 3. anti-silent-drop (ADR 001 §3.4 D4) ───────────────────────────

describe("anti-silent-drop diagnostics", () => {
  it("lowers bindAnimate to animateBindings without any warning (phase B landed — issue #33)", () => {
    const { warns, root } = collectWarns({
      kind: "frame",
      id: "panel",
      size: { w: 1, h: 1 },
      bindAnimate: { opacity: "ui.panel.opacity" },
    });
    expect(warns).toHaveLength(0);
    expect(root.animateBindings).toEqual({ opacity: "ui.panel.opacity" });
  });

  it("lowers animate.transition.mass into the spring transition (phase B landed — issue #33)", () => {
    const { warns, root } = collectWarns({
      kind: "frame",
      id: "spring",
      size: { w: 1, h: 1 },
      animate: { transition: { easing: "spring", mass: 2 }, opacity: 1 },
    });
    expect(warns).toHaveLength(0);
    expect(root.transitions?.opacity).toEqual({ kind: "spring", mass: 2 });
  });

  it("strict: true compiles a valid bindAnimate cleanly (no spurious diagnostic)", () => {
    const out = compileBundle(
      bundle({
        kind: "frame",
        size: { w: 1, h: 1 },
        bindAnimate: { opacity: "x" },
      }),
      { strict: true },
    );
    expect(out.root.animateBindings).toEqual({ opacity: "x" });
  });
});
