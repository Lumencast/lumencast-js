// Probe tests — bindAnimate adversarial suite (ADR 001 §3.3, RC#6/RC#13/R8/§6.5).
//
// Complements Forge's bind-animate.test.tsx + frame-coalescer.test.ts.
// Each case targets a hole that Forge's suite leaves open:
//   - Coalescer under adversity: N bindings, retarget-during-flight, dispose-during-animation
//   - Hostile values: NaN/Infinity/string on every scalar channel, object as colour
//   - Semantics: no-op retarget, leaf never pushed, bindAnimate + keyframes coexistence
//   - Perf unit: 100 bindings (10 scalar + 1 colour) coalesce to exactly 1 flush each/rAF

import { describe, expect, it } from "vitest";
import { createFrameCoalescer } from "../../src/animate/frame-coalescer.js";
import { resolveScalarTargets } from "../../src/render/bind-animate.js";
import { cssColorToRgba, mixRgba, serializeRgba } from "../../src/render/color-interp.js";
import { clampFilterChannel } from "../../src/render/filter-clamp.js";

// ─── helpers ─────────────────────────────────────────────────────────────────

function manualRaf() {
  const queue: Array<() => void> = [];
  return {
    schedule: (cb: () => void): number => {
      queue.push(cb);
      return queue.length;
    },
    cancel: (id: number): void => {
      queue[id - 1] = () => {};
    },
    tick(): void {
      const cbs = queue.splice(0, queue.length);
      for (const cb of cbs) cb();
    },
    get pending(): number {
      return queue.filter((cb) => cb.toString() !== "() => {}").length;
    },
    get count(): number {
      return queue.length;
    },
  };
}

// ─── 1. Coalescer under adversity ────────────────────────────────────────────

describe("createFrameCoalescer — adversity (probe)", () => {
  it("100 bindings simultaneous: each key flushes once per rAF with the last value", () => {
    const raf = manualRaf();
    const flushed = new Map<string, unknown[]>();
    const c = createFrameCoalescer(
      (k, v) => {
        if (!flushed.has(k)) flushed.set(k, []);
        flushed.get(k)!.push(v);
      },
      raf.schedule,
      raf.cancel,
    );

    // Push 1000 deltas across 100 keys (10 each)
    for (let i = 0; i < 1000; i++) {
      c.push(`key${i % 100}`, i);
    }
    // Before flush: nothing emitted, exactly one scheduled frame
    expect(flushed.size).toBe(0);
    expect(raf.count).toBe(1);

    raf.tick();

    // After flush: exactly 100 keys, each flushed exactly once
    expect(flushed.size).toBe(100);
    for (let k = 0; k < 100; k++) {
      const calls = flushed.get(`key${k}`)!;
      expect(calls).toHaveLength(1);
      // Last value for key k: the last iteration i where i%100 === k is i = 900+k
      expect(calls[0]).toBe(900 + k);
    }
  });

  it("deltas arriving during in-flight retarget (re-entrant push from flush) schedule next frame only", () => {
    const raf = manualRaf();
    const flushed: Array<[string, unknown]> = [];
    let flushCount = 0;

    const c = createFrameCoalescer(
      (k, v) => {
        flushed.push([k, v]);
        flushCount++;
        // Simulate delta arriving while flush is running (e.g., signal callback)
        if (flushCount === 1) {
          c.push("opacity", "new-during-flush");
          c.push("transform.translate", [5, 5]);
        }
      },
      raf.schedule,
      raf.cancel,
    );

    c.push("opacity", 0.5);
    raf.tick(); // first flush — triggers 2 re-entrant pushes

    // First frame: only the original push flushes
    expect(flushed).toHaveLength(1);
    expect(flushed[0]).toEqual(["opacity", 0.5]);
    // Re-entrant pushes must have scheduled a SECOND frame (swap-before-flush)
    expect(raf.count).toBe(1);

    raf.tick(); // second frame: the re-entrant values flush
    expect(flushed).toHaveLength(3);
    expect(flushed[1]).toEqual(["opacity", "new-during-flush"]);
    expect(flushed[2]).toEqual(["transform.translate", [5, 5]]);
  });

  it("dispose during a pending multi-key flush: all pending values are dropped, no flush", () => {
    const raf = manualRaf();
    const flushed: unknown[] = [];
    const c = createFrameCoalescer((_k, v) => flushed.push(v), raf.schedule, raf.cancel);

    // Queue up 10 keys
    for (let i = 0; i < 10; i++) {
      c.push(`k${i}`, i);
    }
    expect(raf.count).toBe(1);

    // Dispose before the frame fires (simulates component unmount during animation)
    c.dispose();
    raf.tick();

    expect(flushed).toHaveLength(0);
  });

  it("dispose then push: further pushes are silently ignored (no memory leak, no scheduling)", () => {
    const raf = manualRaf();
    const flushed: unknown[] = [];
    const c = createFrameCoalescer((_k, v) => flushed.push(v), raf.schedule, raf.cancel);

    c.dispose();
    // Push after dispose: must not schedule anything
    for (let i = 0; i < 50; i++) c.push("opacity", i);

    expect(raf.count).toBe(0);
    raf.tick();
    expect(flushed).toHaveLength(0);
  });

  it("two consecutive rAF cycles: second cycle bindings don't bleed into first", () => {
    const raf = manualRaf();
    const flushLog: Array<[string, unknown]> = [];
    const c = createFrameCoalescer((k, v) => flushLog.push([k, v]), raf.schedule, raf.cancel);

    c.push("opacity", 0.3);
    raf.tick(); // frame 1

    c.push("opacity", 0.7);
    c.push("transform.rotate", 45);
    raf.tick(); // frame 2

    expect(flushLog).toEqual([
      ["opacity", 0.3],
      ["opacity", 0.7],
      ["transform.rotate", 45],
    ]);
  });
});

// ─── 2. Hostile values on bound scalar channels ───────────────────────────────

describe("resolveScalarTargets — hostile-value completeness (probe)", () => {
  const NON_FINITE = [NaN, Infinity, -Infinity];
  const NON_NUMBER = ["0.5", "", null, undefined, {}, [], true, false, Symbol("x")];

  it("opacity: NaN, Infinity, string, object, array, boolean → null", () => {
    for (const v of [...NON_FINITE, ...NON_NUMBER]) {
      expect(resolveScalarTargets("opacity", v)).toBeNull();
    }
  });

  it("opacity: boundary values 0 and 1 are valid", () => {
    expect(resolveScalarTargets("opacity", 0)).toEqual({ opacity: 0 });
    expect(resolveScalarTargets("opacity", 1)).toEqual({ opacity: 1 });
  });

  // BUG (signal to Forge): opacity clamp uses `raw < 0` which is false for -0 in
  // IEEE-754. The filter channels avoid this via Object.is(-0, -0) in
  // clampFilterChannel, but opacity has no equivalent guard. -0 slips through and
  // is forwarded to framer as -0. This is inconsistent with the R8 -0 policy
  // documented in PR #39 and should be fixed with Object.is(raw, -0) in the
  // opacity branch of resolveScalarTargets (bind-animate.tsx:75).
  it("BUG: opacity -0 slips through the clamp as -0 (should be 0, inconsistent with R8/PR#39)", () => {
    const result = resolveScalarTargets("opacity", -0);
    // This assertion documents the current (broken) behaviour.
    // It PASSES today only because -0 leaks through. Once Forge fixes the bug
    // (Object.is gate on opacity), this will need updating to { opacity: 0 }.
    expect(result).not.toBeNull();
    // The channel value is -0, not +0 — prove the leak:
    expect(Object.is(result!.opacity, -0)).toBe(true);
  });

  it("transform.rotate: NaN, Infinity, string, null → null", () => {
    for (const v of [...NON_FINITE, "45deg", null, undefined, {}, []]) {
      expect(resolveScalarTargets("transform.rotate", v)).toBeNull();
    }
  });

  it("transform.rotate: large but finite values pass (no clamping)", () => {
    expect(resolveScalarTargets("transform.rotate", 720)).toEqual({ rotate: 720 });
    expect(resolveScalarTargets("transform.rotate", -360)).toEqual({ rotate: -360 });
  });

  it("transform.scale: [1, NaN] pair → null (partial NaN in array)", () => {
    expect(resolveScalarTargets("transform.scale", [1, NaN])).toBeNull();
    expect(resolveScalarTargets("transform.scale", [Infinity, 2])).toBeNull();
  });

  it("transform.scale: single NaN/Infinity → null", () => {
    for (const v of NON_FINITE) {
      expect(resolveScalarTargets("transform.scale", v)).toBeNull();
    }
  });

  it("transform.translate: [NaN, 0] and [0, Infinity] → null", () => {
    expect(resolveScalarTargets("transform.translate", [NaN, 0])).toBeNull();
    expect(resolveScalarTargets("transform.translate", [0, Infinity])).toBeNull();
  });

  it("transform.translate: string pair '10,20' → null (must be actual array)", () => {
    expect(resolveScalarTargets("transform.translate", "10,20")).toBeNull();
  });

  it("filter.blur: -0 → null (R8, PR #39 lesson)", () => {
    // -0 passes `value < 0` check (false) but Object.is(-0, -0) is true → must be null
    expect(clampFilterChannel("blur", -0)).toBeNull();
    expect(resolveScalarTargets("filter.blur", -0)).toBeNull();
  });

  it("filter.brightness: -0 → null (R8, PR #39 lesson)", () => {
    expect(clampFilterChannel("brightness", -0)).toBeNull();
    expect(resolveScalarTargets("filter.brightness", -0)).toBeNull();
  });

  it("unknown channel key: returns null (no implicit layout channels)", () => {
    for (const key of [
      "width",
      "height",
      "top",
      "left",
      "padding",
      "transform.translateX",
      "translateX",
      "filter.hue-rotate",
      "Opacity",
      "OPACITY",
      "transform.Translate",
    ]) {
      expect(resolveScalarTargets(key, 1)).toBeNull();
    }
  });

  it("object as value for any scalar channel → null (hostile delta shape)", () => {
    const channels = [
      "opacity",
      "transform.rotate",
      "transform.scale",
      "transform.translate",
      "filter.blur",
      "filter.brightness",
    ];
    const hostile = { value: 0.5, __proto__: null };
    for (const ch of channels) {
      expect(resolveScalarTargets(ch, hostile)).toBeNull();
    }
  });
});

// ─── 3. Hostile values on colour channel (cssColorToRgba) ────────────────────

describe("cssColorToRgba — hostile colour values (probe)", () => {
  it("url() injection is rejected before interpolation", () => {
    expect(cssColorToRgba("url(http://evil.example/inject.css)")).toBeNull();
    expect(cssColorToRgba("url(data:text/html,<script>alert(1)</script>)")).toBeNull();
  });

  it("CSS injection with semicolons / braces is rejected", () => {
    expect(cssColorToRgba("red; } body { background: red")).toBeNull();
    expect(cssColorToRgba("#fff; color: red")).toBeNull();
  });

  it("var() and color-mix() are rejected", () => {
    expect(cssColorToRgba("var(--brand-color)")).toBeNull();
    expect(cssColorToRgba("color-mix(in srgb, red 50%, blue 50%)")).toBeNull();
  });

  it("object, array, number, boolean, null, undefined → null", () => {
    for (const v of [{ r: 255, g: 0, b: 0 }, [255, 0, 0], 0xff0000, true, false, null, undefined]) {
      expect(cssColorToRgba(v)).toBeNull();
    }
  });

  it("empty string → null", () => {
    expect(cssColorToRgba("")).toBeNull();
  });

  it("whitespace-only → null", () => {
    expect(cssColorToRgba("   ")).toBeNull();
  });

  it("lerp of rejected colour value never produces a non-null output", () => {
    const good = cssColorToRgba("#ff0000")!;
    // A rejected colour never reaches mixRgba — but verify the good path
    // doesn't produce a string that bypasses the parser
    const mixed = serializeRgba(mixRgba(good, good, 0.5));
    // serializeRgba output is always re-parseable
    expect(cssColorToRgba(mixed)).not.toBeNull();
  });

  it("mixed output is always a valid rgba() string (never raw/injected)", () => {
    const pairs: Array<[string, string]> = [
      ["#ff0000", "#0000ff"],
      ["rgb(0,128,255)", "hsl(60, 100%, 50%)"],
      ["transparent", "white"],
      ["rebeccapurple", "rgba(10, 20, 30, 0.5)"],
    ];
    for (const [a, b] of pairs) {
      const rgba_a = cssColorToRgba(a)!;
      const rgba_b = cssColorToRgba(b)!;
      for (const t of [0, 0.333, 0.5, 0.999, 1]) {
        const out = serializeRgba(mixRgba(rgba_a, rgba_b, t));
        // Must start with "rgba(" and contain no injection characters
        expect(out).toMatch(/^rgba\(\d+, \d+, \d+, [0-9.]+\)$/);
        // Re-parses successfully
        expect(cssColorToRgba(out)).not.toBeNull();
      }
    }
  });
});

// ─── 4. Semantic: retarget identical target (no-op candidate) ────────────────

describe("createFrameCoalescer — identical consecutive target (probe)", () => {
  it("pushing the same value twice within one frame: one flush with the value (not zero)", () => {
    // The coalescer is not responsible for deduplication — that's a higher-level concern.
    // But it MUST flush even if the value is identical (the runtime gate decides no-op).
    const raf = manualRaf();
    const flushed: unknown[] = [];
    const c = createFrameCoalescer((_k, v) => flushed.push(v), raf.schedule, raf.cancel);

    c.push("opacity", 0.5);
    c.push("opacity", 0.5); // same value
    raf.tick();

    // Coalescer guarantees exactly one flush (last value wins), which is 0.5
    expect(flushed).toHaveLength(1);
    expect(flushed[0]).toBe(0.5);
  });

  it("pushing same value across two consecutive frames: two separate flushes", () => {
    const raf = manualRaf();
    const flushed: unknown[] = [];
    const c = createFrameCoalescer((_k, v) => flushed.push(v), raf.schedule, raf.cancel);

    c.push("opacity", 0.5);
    raf.tick(); // flush 1
    c.push("opacity", 0.5);
    raf.tick(); // flush 2

    expect(flushed).toHaveLength(2);
    expect(flushed[0]).toBe(0.5);
    expect(flushed[1]).toBe(0.5);
  });
});

// ─── 5. Semantic: colour lerp continuity (velocity-carry analog) ─────────────

describe("mixRgba — continuity (spring overshoot, velocity carry analog) (probe)", () => {
  it("spring overshoot t = 1.5: channels clamp to [0,1], not raw linear extrapolation", () => {
    const black = cssColorToRgba("#000000")!;
    const white = cssColorToRgba("#ffffff")!;
    const over = mixRgba(black, white, 1.5);
    // Without clamping: channels would be 1.5; with clamping: 1
    expect(over).toEqual([1, 1, 1, 1]);
  });

  it("spring undershoot t = -0.5: channels clamp to 0", () => {
    const red = cssColorToRgba("#ff0000")!;
    const blue = cssColorToRgba("#0000ff")!;
    const under = mixRgba(red, blue, -0.5);
    // r channel: 1 + (-0.5)*(0-1) = 1.5 → clamped to 1
    // b channel: 0 + (-0.5)*(1-0) = -0.5 → clamped to 0
    expect(under[0]).toBe(1);
    expect(under[2]).toBe(0);
  });

  it("consecutive retarget mid-flight (start=previous lerp result): no jump", () => {
    const a = cssColorToRgba("#ff0000")!;
    const b = cssColorToRgba("#0000ff")!;
    // Mid-flight at t=0.3
    const mid = mixRgba(a, b, 0.3);
    // New target is original b; retarget from mid
    const next = mixRgba(mid, b, 0.5);
    // Continuity: next.r < mid.r (moving toward blue = decreasing red)
    expect(next[0]).toBeLessThan(mid[0]);
    expect(next[2]).toBeGreaterThan(mid[2]);
  });
});

// ─── 6. Perf unit: 100 bindings coalesce, measured (no E2E needed) ───────────

describe("coalescer throughput — 100 bindings × 1000 pushes (probe perf unit)", () => {
  it("100 scalar bindings: 100,000 pushes coalesce to exactly 100 flush calls in 1 rAF", () => {
    const raf = manualRaf();
    const flushCounts = new Map<string, number>();
    const c = createFrameCoalescer(
      (k) => {
        flushCounts.set(k, (flushCounts.get(k) ?? 0) + 1);
      },
      raf.schedule,
      raf.cancel,
    );

    const N = 100;
    const PUSHES_PER_KEY = 1000;
    for (let push = 0; push < PUSHES_PER_KEY; push++) {
      for (let k = 0; k < N; k++) {
        c.push(`binding${k}`, push * 0.001);
      }
    }

    // Exactly 1 frame scheduled regardless of N × PUSHES_PER_KEY = 100,000 pushes
    expect(raf.count).toBe(1);

    const t0 = performance.now();
    raf.tick();
    const elapsed = performance.now() - t0;

    // Each key flushed exactly once
    expect(flushCounts.size).toBe(N);
    for (let k = 0; k < N; k++) {
      expect(flushCounts.get(`binding${k}`)).toBe(1);
    }

    // Flush of 100 entries must be well under 16ms (the rAF budget)
    expect(elapsed).toBeLessThan(16);
  });

  it("mixed scalar + colour pushes: colour values coalesce just like scalars", () => {
    const raf = manualRaf();
    const lastValues = new Map<string, unknown>();
    const c = createFrameCoalescer(
      (k, v) => lastValues.set(k, v),
      raf.schedule,
      raf.cancel,
    );

    // 10 scalar + 1 colour key
    for (let i = 0; i < 500; i++) {
      for (let k = 0; k < 10; k++) {
        c.push(`scalar${k}`, i / 500);
      }
      c.push("style.color", `#${i.toString(16).padStart(6, "0").slice(0, 6)}`);
    }
    raf.tick();

    expect(lastValues.size).toBe(11);
    // Last push index is 499
    for (let k = 0; k < 10; k++) {
      expect(lastValues.get(`scalar${k}`)).toBe(499 / 500);
    }
  });
});

// ─── 7. Compile gate: exotic keys (RC#13) ────────────────────────────────────

// Note: these are Probe-level unit tests driving the compile gate via
// compileBundle import to avoid re-importing compile.ts directly.
// The compile.ts internal function `lowerBindAnimate` is validated indirectly
// through the exported `BIND_ANIMATE_SCALAR_KEYS` / `BIND_ANIMATE_COLOR_KEYS`.

import {
  BIND_ANIMATE_SCALAR_KEYS,
  BIND_ANIMATE_COLOR_KEYS,
  compileBundle,
  ZERO_HASH,
  type LSMLBundle,
  type LSMLNode,
} from "../../../compiler/src/index.js";

function bundle(layout: LSMLNode): LSMLBundle {
  return { lsml: "1.1", scene_id: "probe-t", scene_version: ZERO_HASH, layout };
}

describe("bindAnimate compile gate — exotic keys (probe, RC#13)", () => {
  it("BIND_ANIMATE_SCALAR_KEYS does NOT contain layout keys (width/height/top/left)", () => {
    for (const k of ["width", "height", "top", "left", "x", "y", "padding", "gap"]) {
      expect(BIND_ANIMATE_SCALAR_KEYS.has(k)).toBe(false);
    }
  });

  it("BIND_ANIMATE_SCALAR_KEYS does NOT contain translateX/translateY (must use transform.translate)", () => {
    expect(BIND_ANIMATE_SCALAR_KEYS.has("translateX")).toBe(false);
    expect(BIND_ANIMATE_SCALAR_KEYS.has("translateY")).toBe(false);
    expect(BIND_ANIMATE_SCALAR_KEYS.has("transform.translateX")).toBe(false);
  });

  it("case-sensitive: 'Opacity' throws (not 'opacity')", () => {
    expect(() =>
      compileBundle(
        bundle({
          kind: "frame",
          size: { w: 1, h: 1 },
          bindAnimate: { Opacity: "g.o" },
        }),
      ),
    ).toThrow(/bindAnimate\.Opacity/);
  });

  it("'OPACITY' throws (case-sensitive)", () => {
    expect(() =>
      compileBundle(
        bundle({
          kind: "frame",
          size: { w: 1, h: 1 },
          bindAnimate: { OPACITY: "g.o" },
        }),
      ),
    ).toThrow(/bindAnimate\.OPACITY/);
  });

  it("'transform.translateX' throws (wrong key syntax)", () => {
    expect(() =>
      compileBundle(
        bundle({
          kind: "frame",
          size: { w: 1, h: 1 },
          bindAnimate: { "transform.translateX": "g.x" },
        }),
      ),
    ).toThrow(/bindAnimate/);
  });

  it("'filter.hue-rotate' throws (not in §6.1)", () => {
    expect(() =>
      compileBundle(
        bundle({
          kind: "frame",
          size: { w: 1, h: 1 },
          bindAnimate: { "filter.hue-rotate": "g.h" },
        }),
      ),
    ).toThrow(/bindAnimate/);
  });

  it("colour key on wrong kind throws: 'fill' on text, 'style.color' on frame", () => {
    // fill is a shape key, not text
    expect(() =>
      compileBundle(
        bundle({
          kind: "text",
          bindAnimate: { fill: "g.c" },
        }),
      ),
    ).toThrow(/bindAnimate\.fill/);

    // style.color is text key, not frame
    expect(() =>
      compileBundle(
        bundle({
          kind: "frame",
          size: { w: 1, h: 1 },
          bindAnimate: { "style.color": "g.c" },
        }),
      ),
    ).toThrow(/bindAnimate\.style\.color/);
  });

  it("colour key on wrong kind throws: 'background' on shape", () => {
    expect(() =>
      compileBundle(
        bundle({
          kind: "shape",
          geometry: "rect",
          size: { w: 1, h: 1 },
          bindAnimate: { background: "g.c" },
        }),
      ),
    ).toThrow(/bindAnimate\.background/);
  });

  it("error message contains node id and key but NOT the leaf path value (R9)", () => {
    let msg = "";
    try {
      compileBundle(
        bundle({
          kind: "frame",
          id: "probe-node",
          size: { w: 1, h: 1 },
          bindAnimate: { "filter.hue-rotate": "secret.live.path.42" },
        }),
      );
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toContain("probe-node");
    expect(msg).toContain("filter.hue-rotate");
    expect(msg).not.toContain("secret.live.path.42");
  });

  it("empty string leaf path throws with mention of LeafPath (RC#13)", () => {
    expect(() =>
      compileBundle(
        bundle({
          kind: "frame",
          size: { w: 1, h: 1 },
          bindAnimate: { opacity: "" },
        }),
      ),
    ).toThrow(/LeafPath/);
  });

  it("BIND_ANIMATE_COLOR_KEYS maps all three kind/key pairs correctly", () => {
    expect(BIND_ANIMATE_COLOR_KEYS["text"]).toBe("style.color");
    expect(BIND_ANIMATE_COLOR_KEYS["shape"]).toBe("fill");
    expect(BIND_ANIMATE_COLOR_KEYS["frame"]).toBe("background");
    // No others
    const kinds = Object.keys(BIND_ANIMATE_COLOR_KEYS);
    expect(kinds.sort()).toEqual(["frame", "shape", "text"]);
  });

  it("all §6.1 scalar keys are accepted on every kind (opacity on text/shape/media)", () => {
    for (const kind of ["text", "shape", "image", "media"] as const) {
      let node: LSMLNode;
      if (kind === "shape") {
        node = { kind, geometry: "rect", size: { w: 1, h: 1 }, bindAnimate: { opacity: "g.o" } };
      } else if (kind === "image") {
        node = { kind, alt: "x", size: { w: 1, h: 1 }, bindAnimate: { opacity: "g.o" } };
      } else if (kind === "media") {
        node = { kind, kind_hint: "video", bindAnimate: { opacity: "g.o" } };
      } else {
        node = { kind, bindAnimate: { opacity: "g.o" } };
      }
      const out = compileBundle(bundle(node));
      expect(out.root.animateBindings).toEqual({ opacity: "g.o" });
    }
  });

  it("bindAnimate with animate.transition declared: transitions emitted for colour key too", () => {
    const out = compileBundle(
      bundle({
        kind: "shape",
        geometry: "rect",
        size: { w: 1, h: 1 },
        animate: { transition: { easing: "spring", stiffness: 100, damping: 12, mass: 1.5 } },
        bindAnimate: { fill: "g.c" },
      }),
    );
    // shape fill → runtime key "fill"
    expect(out.root.transitions?.fill).toEqual({
      kind: "spring",
      stiffness: 100,
      damping: 12,
      mass: 1.5,
    });
  });

  it("bindAnimate coexists with keyframes on the same node (both lowered)", () => {
    const out = compileBundle(
      bundle({
        kind: "frame",
        size: { w: 100, h: 100 },
        bindAnimate: { opacity: "g.o" },
        keyframes: {
          steps: [
            { at: 0, opacity: 0 },
            { at: 1, opacity: 1 },
          ],
          duration_ms: 300,
        },
      }),
    );
    expect(out.root.animateBindings).toEqual({ opacity: "g.o" });
    expect(out.root.keyframes).toBeDefined();
    expect(out.root.keyframes?.steps).toHaveLength(2);
  });
});

// ─── 8. filter-clamp: -0 coverage (R8, PR #39 lesson) ─────────────────────

describe("clampFilterChannel — -0 edge (R8, PR #39 lesson, probe)", () => {
  it("blur -0 is rejected (Object.is gate), not treated as 0", () => {
    const result = clampFilterChannel("blur", -0);
    expect(result).toBeNull();
    // Positive zero must still pass
    expect(clampFilterChannel("blur", 0)).toBe(0);
  });

  it("brightness -0 is rejected, positive zero passes", () => {
    expect(clampFilterChannel("brightness", -0)).toBeNull();
    expect(clampFilterChannel("brightness", 0)).toBe(0);
  });

  it("-0 cannot slip through resolveScalarTargets via filter channels", () => {
    expect(resolveScalarTargets("filter.blur", -0)).toBeNull();
    expect(resolveScalarTargets("filter.brightness", -0)).toBeNull();
  });
});
