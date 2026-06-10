// Issue #42 — runtime half of the R8 filter gate (ADR 001 §5.1 R8).
//
// Hostile-delta fixtures : any `filter` value reaching the runtime live
// (resolveProps / animateBindings) or via a hand-crafted bundle
// (animate_initial, keyframe steps) is clamped or rejected — never
// applied raw. Caps mirror the compiler's (unification tracked by #41).

import { describe, expect, it } from "vitest";
import {
  clampFilterChannel,
  sanitizeCssFilterString,
  FILTER_IDENTITY,
  MAX_FILTER_BLUR_PX,
  MAX_FILTER_BRIGHTNESS,
} from "../../src/render/filter-clamp.js";
import {
  MAX_FILTER_BLUR_PX as COMPILER_BLUR_CAP,
  MAX_FILTER_BRIGHTNESS as COMPILER_BRIGHTNESS_CAP,
} from "../../../compiler/src/compile.js";

describe("caps stay aligned with the compiler (issue #41 sentinel)", () => {
  it("blur and brightness caps equal the compiler constants", () => {
    expect(MAX_FILTER_BLUR_PX).toBe(COMPILER_BLUR_CAP);
    expect(MAX_FILTER_BRIGHTNESS).toBe(COMPILER_BRIGHTNESS_CAP);
  });
});

describe("clampFilterChannel — numeric live values (R8)", () => {
  it("passes in-range values through unchanged", () => {
    expect(clampFilterChannel("blur", 12.5)).toBe(12.5);
    expect(clampFilterChannel("brightness", 1.5)).toBe(1.5);
    expect(clampFilterChannel("blur", 0)).toBe(0);
  });

  it("clamps oversized values to the cap (giant blur, extreme brightness)", () => {
    expect(clampFilterChannel("blur", 1e9)).toBe(MAX_FILTER_BLUR_PX);
    expect(clampFilterChannel("blur", 101)).toBe(MAX_FILTER_BLUR_PX);
    expect(clampFilterChannel("brightness", 4000)).toBe(MAX_FILTER_BRIGHTNESS);
  });

  it("rejects negatives — including -0", () => {
    expect(clampFilterChannel("blur", -1)).toBeNull();
    expect(clampFilterChannel("brightness", -0.0001)).toBeNull();
    expect(clampFilterChannel("blur", -0)).toBeNull();
  });

  it("rejects non-finite and non-number types (hostile delta shapes)", () => {
    for (const v of [
      NaN,
      Infinity,
      -Infinity,
      "50",
      "url(x)",
      null,
      undefined,
      [50],
      { blur: 5 },
      true,
    ]) {
      expect(clampFilterChannel("blur", v)).toBeNull();
    }
  });
});

describe("sanitizeCssFilterString — string form (hand-crafted bundles)", () => {
  it("accepts the canonical compiler emission", () => {
    expect(sanitizeCssFilterString("blur(0px) brightness(1)")).toBe(FILTER_IDENTITY);
    expect(sanitizeCssFilterString("blur(12.5px) brightness(0.8)")).toBe(
      "blur(12.5px) brightness(0.8)",
    );
  });

  it("re-clamps oversized channels", () => {
    expect(sanitizeCssFilterString("blur(9999999px) brightness(9999999)")).toBe(
      `blur(${MAX_FILTER_BLUR_PX}px) brightness(${MAX_FILTER_BRIGHTNESS})`,
    );
  });

  it("rejects injections, negatives and foreign functions", () => {
    for (const v of [
      "blur(-5px) brightness(1)",
      "blur(5px) brightness(-1)",
      "url(http://evil)",
      "blur(5px) url(x)",
      "blur(5px); background: red",
      "drop-shadow(0 0 10px red)",
      "blur(1e9px) brightness(1)",
      "blur(5px) brightness(1) blur(5px)",
      "",
      42,
      null,
      ["blur(5px) brightness(1)"],
    ]) {
      expect(sanitizeCssFilterString(v)).toBeNull();
    }
  });

  it("rejects oversize input before any parse (bounded work, RC#12)", () => {
    expect(sanitizeCssFilterString("blur(5px) brightness(1)" + " ".repeat(200))).toBeNull();
  });
});
