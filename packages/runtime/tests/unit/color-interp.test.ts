// Issue #33 — sRGB colour interpolation (LSML §6.5).
//
// Both endpoints MUST canonicalise through the strict shared parser
// (css-color.ts) before interpolation — a value the parser rejects
// never produces channels (RC#11). Mixing is component-wise in sRGB
// (§6.5 step 2) and the serialised output re-passes the strict parser
// (step 3, belt and braces at the consuming primitive).

import { describe, expect, it } from "vitest";
import { cssColorToRgba, mixRgba, serializeRgba } from "../../src/render/color-interp.js";
import { parseCssColor } from "../../src/render/css-color.js";

describe("cssColorToRgba — canonicalisation through the strict parser", () => {
  it("parses hex forms (#rgb / #rgba / #rrggbb / #rrggbbaa)", () => {
    expect(cssColorToRgba("#f00")).toEqual([1, 0, 0, 1]);
    expect(cssColorToRgba("#ff0000")).toEqual([1, 0, 0, 1]);
    expect(cssColorToRgba("#00ff0080")).toEqual([0, 1, 0, 128 / 255]);
    expect(cssColorToRgba("#0f08")).toEqual([0, 1, 0, 136 / 255]);
  });

  it("parses rgb()/rgba() — plain and percent channels", () => {
    expect(cssColorToRgba("rgb(255, 0, 0)")).toEqual([1, 0, 0, 1]);
    expect(cssColorToRgba("rgba(0, 255, 0, 0.5)")).toEqual([0, 1, 0, 0.5]);
    expect(cssColorToRgba("rgb(100%, 0%, 50%)")).toEqual([1, 0, 0.5, 1]);
  });

  it("parses hsl()/hsla() via the standard conversion", () => {
    expect(cssColorToRgba("hsl(0, 100%, 50%)")).toEqual([1, 0, 0, 1]);
    expect(cssColorToRgba("hsl(120, 100%, 50%)")).toEqual([0, 1, 0, 1]);
    const [r, g, b, a] = cssColorToRgba("hsla(240, 100%, 50%, 0.25)")!;
    expect([r, g, b]).toEqual([0, 0, 1]);
    expect(a).toBe(0.25);
  });

  it("parses named colours and transparent", () => {
    expect(cssColorToRgba("red")).toEqual([1, 0, 0, 1]);
    expect(cssColorToRgba("REBECCAPURPLE")).toEqual([0x66 / 255, 0x33 / 255, 0x99 / 255, 1]);
    expect(cssColorToRgba("transparent")).toEqual([0, 0, 0, 0]);
  });

  it("rejects what the strict parser rejects — and currentcolor", () => {
    for (const v of [
      "url(http://x)",
      "red; }",
      "var(--x)",
      "color-mix(in srgb, red, blue)",
      "currentcolor",
      "",
      42,
      null,
      undefined,
      ["#fff"],
    ]) {
      expect(cssColorToRgba(v)).toBeNull();
    }
  });
});

describe("mixRgba — component-wise sRGB lerp (§6.5)", () => {
  it("t=0 returns a, t=1 returns b, t=0.5 the channel midpoint", () => {
    const a = cssColorToRgba("#ff0000")!;
    const b = cssColorToRgba("#0000ff")!;
    expect(mixRgba(a, b, 0)).toEqual([1, 0, 0, 1]);
    expect(mixRgba(a, b, 1)).toEqual([0, 0, 1, 1]);
    expect(mixRgba(a, b, 0.5)).toEqual([0.5, 0, 0.5, 1]);
  });

  it("clamps overshoot (spring t > 1) back into [0, 1]", () => {
    const a = cssColorToRgba("#000000")!;
    const b = cssColorToRgba("#ffffff")!;
    expect(mixRgba(a, b, 1.2)).toEqual([1, 1, 1, 1]);
    expect(mixRgba(a, b, -0.2)).toEqual([0, 0, 0, 1]);
  });

  it("interpolates alpha too", () => {
    const a = cssColorToRgba("rgba(0, 0, 0, 0)")!;
    const b = cssColorToRgba("rgba(0, 0, 0, 1)")!;
    expect(mixRgba(a, b, 0.25)[3]).toBe(0.25);
  });
});

describe("serializeRgba — output re-accepted by the strict parser", () => {
  it("serialises to rgba() that parseCssColor accepts", () => {
    const mid = mixRgba(cssColorToRgba("#ff0000")!, cssColorToRgba("#0000ff")!, 0.5);
    const s = serializeRgba(mid);
    expect(s).toBe("rgba(128, 0, 128, 1)");
    expect(parseCssColor(s)).not.toBeNull();
  });

  it("bounds alpha to 4 decimals (strict grammar)", () => {
    const s = serializeRgba([0, 0, 0, 1 / 3]);
    expect(s).toBe("rgba(0, 0, 0, 0.3333)");
    expect(parseCssColor(s)).not.toBeNull();
  });

  it("fuzz : every named/hex/rgb/hsl mix round-trips through the parser", () => {
    const endpoints = ["tomato", "#22d3ee", "rgb(10, 20, 30)", "hsl(200, 50%, 40%)", "#0f08"];
    for (const ax of endpoints) {
      for (const bx of endpoints) {
        for (const t of [0, 0.123, 0.5, 0.987, 1]) {
          const s = serializeRgba(mixRgba(cssColorToRgba(ax)!, cssColorToRgba(bx)!, t));
          expect(parseCssColor(s)).not.toBeNull();
        }
      }
    }
  });
});
