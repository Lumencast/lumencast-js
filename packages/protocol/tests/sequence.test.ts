import { describe, expect, it } from "vitest";
import { SequenceTracker } from "../src/index.js";

describe("SequenceTracker", () => {
  it("accepts contiguous seq starting at 1", () => {
    const t = new SequenceTracker();
    expect(t.observe(1)).toEqual({ kind: "in-order", seq: 1 });
    expect(t.observe(2)).toEqual({ kind: "in-order", seq: 2 });
    expect(t.observe(3)).toEqual({ kind: "in-order", seq: 3 });
    expect(t.last).toBe(3);
  });

  it("flags a duplicate seq", () => {
    const t = new SequenceTracker();
    t.observe(1);
    t.observe(2);
    expect(t.observe(2)).toEqual({ kind: "duplicate", seq: 2, lastSeq: 2 });
    expect(t.observe(1)).toEqual({ kind: "duplicate", seq: 1, lastSeq: 2 });
  });

  it("flags a gap when seq jumps forward", () => {
    const t = new SequenceTracker();
    t.observe(1);
    expect(t.observe(3)).toEqual({ kind: "gap", seq: 3, lastSeq: 1 });
  });

  it("treats malformed seq as gap", () => {
    const t = new SequenceTracker();
    expect(t.observe(0)).toEqual({ kind: "gap", seq: 0, lastSeq: 0 });
    expect(t.observe(1.5)).toEqual({ kind: "gap", seq: 1.5, lastSeq: 0 });
  });

  it("resets to allow seq=1 after scene_changed", () => {
    const t = new SequenceTracker();
    t.observe(1);
    t.observe(2);
    t.observe(3);
    t.reset();
    expect(t.last).toBe(0);
    expect(t.observe(1)).toEqual({ kind: "in-order", seq: 1 });
  });
});
