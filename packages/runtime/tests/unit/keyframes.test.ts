import { describe, expect, it } from "vitest";
import { compileForFramer, type Keyframes } from "../../src/animate/keyframes.js";
import { computeStaggerDelayMs, STAGGER_CAP_MS } from "../../src/render/stagger-context.js";

describe("LSML 1.1 §6.6 — keyframes.compileForFramer", () => {
  it("returns undefined when steps is empty or has fewer than 2 entries", () => {
    expect(compileForFramer({ steps: [], duration_ms: 200 } as Keyframes)).toBeUndefined();
    expect(
      compileForFramer({ steps: [{ at: 0, opacity: 1 }], duration_ms: 200 } as Keyframes),
    ).toBeUndefined();
  });

  it("rejects sequences whose first step is not at 0 or last is not at 1", () => {
    expect(
      compileForFramer({
        steps: [
          { at: 0.1, opacity: 0 },
          { at: 1, opacity: 1 },
        ],
        duration_ms: 200,
      }),
    ).toBeUndefined();
    expect(
      compileForFramer({
        steps: [
          { at: 0, opacity: 0 },
          { at: 0.9, opacity: 1 },
        ],
        duration_ms: 200,
      }),
    ).toBeUndefined();
  });

  it("flattens opacity + transform.scale across 3 steps", () => {
    const compiled = compileForFramer({
      steps: [
        { at: 0, opacity: 0, transform: { scale: 0.8 } },
        { at: 0.6, opacity: 1, transform: { scale: 1.05 } },
        { at: 1, transform: { scale: 1 } },
      ],
      duration_ms: 300,
      easing: "ease-out",
    });
    expect(compiled).toBeDefined();
    expect(compiled?.animate.opacity).toEqual([0, 1, 1]);
    expect(compiled?.animate.scale).toEqual([0.8, 1.05, 1]);
    expect(compiled?.transition.times).toEqual([0, 0.6, 1]);
    expect(compiled?.transition.duration).toBeCloseTo(0.3, 5);
    expect(compiled?.transition.ease).toBe("easeOut");
  });

  it("converts rotate values to deg strings for framer-motion", () => {
    const compiled = compileForFramer({
      steps: [
        { at: 0, transform: { rotate: 0 } },
        { at: 1, transform: { rotate: 360 } },
      ],
      duration_ms: 1000,
    });
    expect(compiled?.animate.rotate).toEqual(["0deg", "360deg"]);
  });

  it("defaults easing to linear when omitted", () => {
    const compiled = compileForFramer({
      steps: [
        { at: 0, opacity: 0 },
        { at: 1, opacity: 1 },
      ],
      duration_ms: 100,
    });
    expect(compiled?.transition.ease).toBe("linear");
  });

  it("only emits channels that appear in at least one step", () => {
    const compiled = compileForFramer({
      steps: [
        { at: 0, opacity: 0 },
        { at: 1, opacity: 1 },
      ],
      duration_ms: 100,
    });
    expect(compiled?.animate).toHaveProperty("opacity");
    expect(compiled?.animate.scale).toBeUndefined();
    expect(compiled?.animate.translateX).toBeUndefined();
    expect(compiled?.animate.rotate).toBeUndefined();
  });
});

describe("LSML 1.1 §6.7 — computeStaggerDelayMs", () => {
  it("returns 0 when stagger_ms is 0 or negative", () => {
    expect(computeStaggerDelayMs(5, 0)).toBe(0);
    expect(computeStaggerDelayMs(5, -10)).toBe(0);
  });

  it("multiplies index by stagger_ms", () => {
    expect(computeStaggerDelayMs(0, 80)).toBe(0);
    expect(computeStaggerDelayMs(1, 80)).toBe(80);
    expect(computeStaggerDelayMs(5, 80)).toBe(400);
  });

  it("caps the cumulative delay at STAGGER_CAP_MS", () => {
    expect(computeStaggerDelayMs(50, 80)).toBe(STAGGER_CAP_MS);
    expect(computeStaggerDelayMs(1000, 100)).toBe(STAGGER_CAP_MS);
  });
});
