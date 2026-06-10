// ADR 001 RC#13 — per-frame delta coalescing (bindAnimate anti-DoS).
//
// A 1 kHz producer must trigger at most ONE retarget per rAF per
// binding. The coalescer is pure scheduling logic with injectable rAF,
// so the bound is proven deterministically here (the live 1 kHz flow is
// re-proven in E2E, tests/e2e/bind-animate.spec.ts).

import { describe, expect, it } from "vitest";
import { createFrameCoalescer } from "../../src/animate/frame-coalescer.js";

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
      return queue.length;
    },
  };
}

describe("createFrameCoalescer", () => {
  it("1000 pushes on one key within a frame flush exactly once, with the LAST value", () => {
    const raf = manualRaf();
    const flushed: Array<[string, unknown]> = [];
    const c = createFrameCoalescer((k, v) => flushed.push([k, v]), raf.schedule, raf.cancel);

    for (let i = 0; i < 1000; i++) c.push("opacity", i / 1000);
    expect(flushed).toHaveLength(0); // nothing before the frame
    expect(raf.pending).toBe(1); // one scheduled frame, not 1000

    raf.tick();
    expect(flushed).toEqual([["opacity", 0.999]]);
  });

  it("coalesces per KEY — interleaved keys each flush once per frame", () => {
    const raf = manualRaf();
    const flushed: Array<[string, unknown]> = [];
    const c = createFrameCoalescer((k, v) => flushed.push([k, v]), raf.schedule, raf.cancel);

    for (let i = 0; i < 100; i++) {
      c.push("opacity", i);
      c.push("transform.translate", [i, i]);
    }
    raf.tick();
    expect(flushed).toEqual([
      ["opacity", 99],
      ["transform.translate", [99, 99]],
    ]);
  });

  it("a push after a flush schedules the NEXT frame (no same-frame re-entry)", () => {
    const raf = manualRaf();
    const flushed: unknown[] = [];
    const c = createFrameCoalescer(
      (_k, v) => {
        flushed.push(v);
        if (flushed.length === 1) c.push("k", "re-entrant");
      },
      raf.schedule,
      raf.cancel,
    );
    c.push("k", "first");
    raf.tick();
    expect(flushed).toEqual(["first"]);
    raf.tick();
    expect(flushed).toEqual(["first", "re-entrant"]);
  });

  it("dispose cancels the scheduled frame and drops pending values", () => {
    const raf = manualRaf();
    const flushed: unknown[] = [];
    const c = createFrameCoalescer((_k, v) => flushed.push(v), raf.schedule, raf.cancel);
    c.push("k", 1);
    c.dispose();
    raf.tick();
    expect(flushed).toHaveLength(0);
    c.push("k", 2); // post-dispose pushes are ignored
    raf.tick();
    expect(flushed).toHaveLength(0);
  });
});
