import { describe, expect, it } from "vitest";
import { createReconnectSchedule } from "../../src/transport/reconnect.js";

describe("reconnect schedule", () => {
  it("computes exponential delays without jitter", () => {
    const sched = createReconnectSchedule({ initial: 100, factor: 2, max: 5000, jitter: 0 });
    expect(sched.delayFor(1)).toBe(100);
    expect(sched.delayFor(2)).toBe(200);
    expect(sched.delayFor(3)).toBe(400);
    expect(sched.delayFor(10)).toBe(5000); // capped
  });

  it("applies jitter within bounds", () => {
    const random = () => 0.75; // → +0.5 fraction → +20% of 100 → 110
    const sched = createReconnectSchedule({
      initial: 100,
      factor: 2,
      max: 1000,
      jitter: 0.2,
      random,
    });
    expect(sched.delayFor(1)).toBeCloseTo(110);
  });

  it("rejects bad options", () => {
    expect(() => createReconnectSchedule({ initial: 0 })).toThrow();
    expect(() => createReconnectSchedule({ initial: 100, max: 50 })).toThrow();
    expect(() => createReconnectSchedule({ factor: 0.5 })).toThrow();
    expect(() => createReconnectSchedule({ jitter: 1.5 })).toThrow();
  });

  it("reset clears the attempt counter", () => {
    const sched = createReconnectSchedule({ jitter: 0 });
    sched.delayFor(3);
    expect(sched.attempt).toBe(3);
    sched.reset();
    expect(sched.attempt).toBe(0);
  });
});
