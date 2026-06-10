// Issue #33 — `bindAnimate` lowering (LSML §6.3, ADR 001 §3.3 D3).
//
// Contractual (Bastion, RC#13) : any bindAnimate key outside the §6.1
// animatable set (plus the kind's §6.5 colour-typed property) is a HARD
// compile error — throw, not warn (exception to the §3.4 warn-by-default
// policy, motivated in the ADR). R9 : error messages name the node and
// the offending key, never the bound leaf-path value.

import { describe, expect, it } from "vitest";
import { compileBundle, ZERO_HASH, type LSMLBundle, type LSMLNode } from "../src/index.js";

function bundle(layout: LSMLNode): LSMLBundle {
  return { lsml: "1.1", scene_id: "t", scene_version: ZERO_HASH, layout };
}

describe("bindAnimate lowering (§6.3)", () => {
  it("lowers every §6.1 scalar key verbatim to animateBindings", () => {
    const out = compileBundle(
      bundle({
        kind: "frame",
        id: "gauge",
        size: { w: 100, h: 10 },
        bindAnimate: {
          opacity: "g.o",
          "transform.translate": "g.pos",
          "transform.scale": "g.s",
          "transform.rotate": "g.r",
          "filter.blur": "g.b",
          "filter.brightness": "g.br",
        },
      }),
    );
    expect(out.root.animateBindings).toEqual({
      opacity: "g.o",
      "transform.translate": "g.pos",
      "transform.scale": "g.s",
      "transform.rotate": "g.r",
      "filter.blur": "g.b",
      "filter.brightness": "g.br",
    });
  });

  it("allows the kind's §6.5 colour-typed key (text/style.color, shape/fill, frame/background)", () => {
    const text = compileBundle(
      bundle({ kind: "text", id: "t", bindAnimate: { "style.color": "ui.c" } }),
    );
    expect(text.root.animateBindings).toEqual({ "style.color": "ui.c" });

    const shape = compileBundle(
      bundle({
        kind: "shape",
        geometry: "rect",
        size: { w: 1, h: 1 },
        bindAnimate: { fill: "ui.c" },
      }),
    );
    expect(shape.root.animateBindings).toEqual({ fill: "ui.c" });

    const frame = compileBundle(
      bundle({ kind: "frame", size: { w: 1, h: 1 }, bindAnimate: { background: "ui.c" } }),
    );
    expect(frame.root.animateBindings).toEqual({ background: "ui.c" });
  });

  it("THROWS (not warns) on a layout property key — RC#13", () => {
    for (const key of ["width", "height", "top", "left", "style.fontSize"]) {
      const warns: string[] = [];
      expect(() =>
        compileBundle(
          bundle({
            kind: "frame",
            id: "evil",
            size: { w: 1, h: 1 },
            bindAnimate: { [key]: "x" },
          }),
          { onWarn: (m) => warns.push(m) },
        ),
      ).toThrow(/bindAnimate/);
      expect(warns).toHaveLength(0);
    }
  });

  it("throws on a colour key declared on the wrong kind", () => {
    expect(() =>
      compileBundle(bundle({ kind: "text", id: "t", bindAnimate: { background: "ui.c" } })),
    ).toThrow(/bindAnimate\.background/);
    expect(() =>
      compileBundle(
        bundle({ kind: "frame", size: { w: 1, h: 1 }, bindAnimate: { "style.color": "ui.c" } }),
      ),
    ).toThrow(/bindAnimate\.style\.color/);
  });

  it("error names node + key but never the bound path value (R9)", () => {
    let message = "";
    try {
      compileBundle(
        bundle({
          kind: "frame",
          id: "panel",
          size: { w: 1, h: 1 },
          bindAnimate: { width: "secret.live.path" },
        }),
      );
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('"panel"');
    expect(message).toContain("bindAnimate.width");
    expect(message).not.toContain("secret.live.path");
  });

  it("throws on an empty / non-string leaf path", () => {
    expect(() =>
      compileBundle(bundle({ kind: "frame", size: { w: 1, h: 1 }, bindAnimate: { opacity: "" } })),
    ).toThrow(/LeafPath/);
  });

  it("emits per-prop transitions for bound channels when animate.transition is declared", () => {
    const out = compileBundle(
      bundle({
        kind: "frame",
        size: { w: 1, h: 1 },
        animate: { transition: { easing: "spring", stiffness: 120, damping: 14, mass: 2 } },
        bindAnimate: {
          opacity: "g.o",
          "transform.translate": "g.pos",
          "filter.blur": "g.b",
        },
      }),
    );
    const spring = { kind: "spring", stiffness: 120, damping: 14, mass: 2 };
    expect(out.root.transitions?.opacity).toEqual(spring);
    expect(out.root.transitions?.x).toEqual(spring);
    expect(out.root.transitions?.y).toEqual(spring);
    expect(out.root.transitions?.filter).toEqual(spring);
  });

  it("emits the colour transition under the runtime prop name (text → colour)", () => {
    const out = compileBundle(
      bundle({
        kind: "text",
        animate: { transition: { duration: 300, easing: "linear" } },
        bindAnimate: { "style.color": "ui.c" },
      }),
    );
    expect(out.root.transitions?.colour).toEqual({
      kind: "tween",
      duration_ms: 300,
      ease: "linear",
    });
  });
});
