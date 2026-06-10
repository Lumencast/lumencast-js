// Issue #33 — `transition.mass` (LSML §6.2) through the runtime
// transition pipeline ; issue #42 — R8 filter gate on the static string
// entry points (`animate_initial.filter`, keyframe `steps[].filter`)
// that a hand-crafted bundle reaches without the compiler clamps.

import { describe, expect, it, vi } from "vitest";
import { mountPlay, parseWireTransition, toFramer } from "../../src/animate/transitions.js";
import { compileForFramer } from "../../src/animate/keyframes.js";
import { FILTER_IDENTITY, MAX_FILTER_BLUR_PX } from "../../src/render/filter-clamp.js";

describe("spring mass (§6.2)", () => {
  it("toFramer forwards mass on spring transitions", () => {
    expect(toFramer({ kind: "spring", stiffness: 120, damping: 14, mass: 2 })).toEqual({
      type: "spring",
      stiffness: 120,
      damping: 14,
      mass: 2,
    });
  });

  it("toFramer omits mass when undeclared (framer default 1 applies)", () => {
    expect(toFramer({ kind: "spring" })).toEqual({ type: "spring" });
  });

  it("parseWireTransition ingests mass from the LSDP §3.2.2 wire shape", () => {
    expect(parseWireTransition({ kind: "spring", stiffness: 200, damping: 20, mass: 3 })).toEqual({
      kind: "spring",
      stiffness: 200,
      damping: 20,
      mass: 3,
    });
    // non-numeric mass is ignored, not forwarded
    expect(parseWireTransition({ kind: "spring", mass: "heavy" })).toEqual({ kind: "spring" });
  });
});

describe("R8 runtime gate — animate_initial.filter (issue #42)", () => {
  it("re-clamps an oversized filter string from a hand-crafted bundle", () => {
    const play = mountPlay({ opacity: 1 }, { opacity: 0, filter: "blur(99999px) brightness(1)" });
    expect(play.initial.filter).toBe(`blur(${MAX_FILTER_BLUR_PX}px) brightness(1)`);
  });

  it("drops a hostile filter string entirely (value never reaches framer, never logged)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const play = mountPlay({ opacity: 1 }, { opacity: 0, filter: "url(http://evil)" });
    expect(play.initial.filter).toBeUndefined();
    expect(play.initial.opacity).toBe(0); // the rest of the mount-play survives
    const logged = warnSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logged).not.toContain("evil");
    warnSpy.mockRestore();
  });

  it("passes a canonical compiler emission through unchanged", () => {
    const play = mountPlay({ opacity: 1 }, { filter: "blur(4px) brightness(0.5)" });
    expect(play.initial.filter).toBe("blur(4px) brightness(0.5)");
    expect(play.animate.filter).toBe(FILTER_IDENTITY);
  });
});

describe("R8 runtime gate — keyframe steps[].filter (issue #42)", () => {
  it("re-clamps and falls back to identity on hostile step filters", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const compiled = compileForFramer({
      steps: [
        { at: 0, filter: "blur(0px) brightness(1)" },
        { at: 0.5, filter: "blur(5000px) brightness(9000)" },
        { at: 1, filter: "url(http://evil)" },
      ],
      duration_ms: 300,
    });
    expect(compiled?.animate.filter).toEqual([
      FILTER_IDENTITY,
      `blur(${MAX_FILTER_BLUR_PX}px) brightness(4)`,
      // hostile last step → treated as omitted → last-known-good
      `blur(${MAX_FILTER_BLUR_PX}px) brightness(4)`,
    ]);
    const logged = warnSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logged).not.toContain("evil");
    warnSpy.mockRestore();
  });
});
