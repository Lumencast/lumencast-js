// Unit tests for the per-scene replay buffer (LSDP/1.1 §18.1).

import { describe, expect, it } from "vitest";

import { ReplayBuffer } from "../src/replay-buffer.js";

describe("ReplayBuffer", () => {
  it("push then since(0) returns everything", () => {
    const b = new ReplayBuffer(4);
    for (let i = 1; i <= 3; i++) b.push({ seq: i, patches: [{ path: "x", value: i }] });
    expect(b.length).toBe(3);
    const { records, covered } = b.since(0);
    expect(covered).toBe(true);
    expect(records.map((r) => r.seq)).toEqual([1, 2, 3]);
  });

  it("ring wraparound — buffer holds the last N", () => {
    const b = new ReplayBuffer(4);
    for (let i = 1; i <= 10; i++) b.push({ seq: i, patches: [] });
    expect(b.length).toBe(4);
    const { records, covered } = b.since(6);
    expect(covered).toBe(true);
    expect(records.map((r) => r.seq)).toEqual([7, 8, 9, 10]);
  });

  it("returns covered=false when sinceSeq is older than the window", () => {
    const b = new ReplayBuffer(4);
    for (let i = 1; i <= 10; i++) b.push({ seq: i, patches: [] });
    // earliest retained is 7 — sinceSeq=2 means "give me 3..10" but we
    // only have 7..10, so the gap is uncovered.
    const { covered } = b.since(2);
    expect(covered).toBe(false);
  });

  it("caught-up subscriber gets covered=true with empty records", () => {
    const b = new ReplayBuffer(4);
    for (let i = 1; i <= 3; i++) b.push({ seq: i, patches: [] });
    const { records, covered } = b.since(3);
    expect(covered).toBe(true);
    expect(records).toEqual([]);
  });

  it("reset clears state", () => {
    const b = new ReplayBuffer(4);
    b.push({ seq: 1, patches: [] });
    b.reset();
    expect(b.length).toBe(0);
  });

  it("empty buffer — covered=true regardless of sinceSeq", () => {
    const b = new ReplayBuffer(4);
    const { records, covered } = b.since(99);
    expect(covered).toBe(true);
    expect(records).toEqual([]);
  });
});
