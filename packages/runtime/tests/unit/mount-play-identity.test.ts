// Issue #29 — mount-play identity targets for the new compiler-lowered
// `animate_initial` keys (per-axis scale + clamped filter string).
//
// `mountPlay` converges every `from` key the primitive doesn't natively
// drive to its identity value. Before #29 the fallback identity for
// unknown keys was 0 — a lowered `from.scaleX: 0.5` would have settled
// at scaleX: 0 (element collapsed) and `from.filter` at the number 0
// (invalid CSS). These tests pin the correct identities.

import { describe, expect, it } from "vitest";
import { mountPlay } from "../../src/animate/transitions.js";

describe("mountPlay identity for 1.1 lowered keys", () => {
  it("per-axis scale settles at 1 (not 0)", () => {
    const play = mountPlay({ opacity: 1 }, { scaleX: 0.5, scaleY: 2 });
    expect(play.initial).toEqual({ scaleX: 0.5, scaleY: 2 });
    expect(play.animate).toEqual({ opacity: 1, scaleX: 1, scaleY: 1 });
  });

  it("filter settles at the two-function identity string", () => {
    const play = mountPlay({ opacity: 1 }, { filter: "blur(4px) brightness(1.2)" });
    expect(play.animate.filter).toBe("blur(0px) brightness(1)");
  });

  it("uniform scale / rotate / x / y identities are unchanged (regression)", () => {
    const play = mountPlay({ opacity: 1 }, { scale: 0.8, rotate: 90, x: 10, y: -5 });
    expect(play.animate).toEqual({ opacity: 1, scale: 1, rotate: 0, x: 0, y: 0 });
  });
});
