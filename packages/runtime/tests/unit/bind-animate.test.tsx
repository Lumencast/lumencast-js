// Issue #33 + #42 — bindAnimate runtime : shape validation of live
// values (hostile-delta fixtures, R8 runtime half) and render
// integration (wrapper, colour canonicalisation, no remount).
//
// Animation RAMPING is empirical and proven in E2E
// (tests/e2e/bind-animate.spec.ts) ; here we prove the gates and the
// wiring deterministically under happy-dom with the real framer-motion.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import {
  resolveScalarTargets,
  DEFAULT_BIND_ANIMATE_TRANSITION,
} from "../../src/render/bind-animate.js";
import { MAX_FILTER_BLUR_PX, MAX_FILTER_BRIGHTNESS } from "../../src/render/filter-clamp.js";
import { Tree } from "../../src/render/tree.js";
import { createStore, type Store } from "../../src/state/store.js";
import type { RenderNode } from "../../src/render/bundle.js";

// ─── 1. resolveScalarTargets — live-value shape gate (§6.3) ──────────

describe("resolveScalarTargets — valid shapes", () => {
  it("opacity : finite number, clamped to [0, 1]", () => {
    expect(resolveScalarTargets("opacity", 0.4)).toEqual({ opacity: 0.4 });
    expect(resolveScalarTargets("opacity", 7)).toEqual({ opacity: 1 });
    expect(resolveScalarTargets("opacity", -2)).toEqual({ opacity: 0 });
  });

  it("transform.translate : [x, y] pair → x / y channels", () => {
    expect(resolveScalarTargets("transform.translate", [10, -20])).toEqual({ x: 10, y: -20 });
  });

  it("transform.scale : scalar drives both axes, pair drives each", () => {
    expect(resolveScalarTargets("transform.scale", 2)).toEqual({ scaleX: 2, scaleY: 2 });
    expect(resolveScalarTargets("transform.scale", [2, 0.5])).toEqual({ scaleX: 2, scaleY: 0.5 });
  });

  it("transform.rotate : finite number", () => {
    expect(resolveScalarTargets("transform.rotate", 45)).toEqual({ rotate: 45 });
  });

  it("filter channels : in-range values pass, oversized clamp to the R8 caps", () => {
    expect(resolveScalarTargets("filter.blur", 10)).toEqual({ blur: 10 });
    expect(resolveScalarTargets("filter.blur", 1e9)).toEqual({ blur: MAX_FILTER_BLUR_PX });
    expect(resolveScalarTargets("filter.brightness", 4000)).toEqual({
      brightness: MAX_FILTER_BRIGHTNESS,
    });
  });
});

describe("resolveScalarTargets — hostile-delta fixtures (issue #42, R8 runtime half)", () => {
  it("filter : negatives, non-finites and foreign types are REJECTED (null), never clamped in", () => {
    for (const v of [-1, -0, NaN, Infinity, "50", "url(evil)", null, [50], { blur: 5 }, true]) {
      expect(resolveScalarTargets("filter.blur", v)).toBeNull();
      expect(resolveScalarTargets("filter.brightness", v)).toBeNull();
    }
  });

  it("translate : wrong arity, non-numeric and object shapes are rejected", () => {
    for (const v of [[1], [1, 2, 3], ["a", "b"], [1, NaN], "1,2", { x: 1, y: 2 }, 5, null]) {
      expect(resolveScalarTargets("transform.translate", v)).toBeNull();
    }
  });

  it("opacity / rotate / scale : non-finite and foreign types are rejected", () => {
    for (const v of [NaN, Infinity, "0.5", null, undefined, {}, true]) {
      expect(resolveScalarTargets("opacity", v)).toBeNull();
      expect(resolveScalarTargets("transform.rotate", v)).toBeNull();
    }
    expect(resolveScalarTargets("transform.scale", [1, "2"])).toBeNull();
  });

  it("unknown channel keys resolve to null (defence in depth vs hand-crafted bundles)", () => {
    expect(resolveScalarTargets("width", 9999)).toBeNull();
    expect(resolveScalarTargets("filter.hue-rotate", 180)).toBeNull();
  });
});

describe("default retarget transition", () => {
  it("is the §6.2 default spring (stiffness 170, damping 26, mass 1)", () => {
    expect(DEFAULT_BIND_ANIMATE_TRANSITION).toEqual({
      kind: "spring",
      stiffness: 170,
      damping: 26,
      mass: 1,
    });
  });
});

// ─── 2. render integration (happy-dom, real framer-motion) ───────────

let container: HTMLDivElement;
let root: Root;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  warnSpy.mockRestore();
});

async function render(node: RenderNode, store: Store): Promise<void> {
  await act(async () => {
    root.render(<Tree node={node} store={store} />);
  });
}

describe("bindAnimate render integration", () => {
  it("scalar bindings mount a motion wrapper ; nodes without bindings do not", async () => {
    const store = createStore();
    store.set("g.o", 0.4);
    await render(
      {
        kind: "frame",
        id: "gauge",
        props: { width: 10, height: 10 },
        animateBindings: { opacity: "g.o" },
      },
      store,
    );
    expect(container.querySelector('[data-lumencast-bind-animate="gauge"]')).not.toBeNull();

    const store2 = createStore();
    const c2 = document.createElement("div");
    document.body.appendChild(c2);
    const r2 = createRoot(c2);
    await act(async () => {
      r2.render(<Tree node={{ kind: "frame", props: { width: 10, height: 10 } }} store={store2} />);
    });
    expect(c2.querySelector("[data-lumencast-bind-animate]")).toBeNull();
    await act(async () => r2.unmount());
    c2.remove();
  });

  it("colour-only bindings do NOT mount a wrapper — the interpolated value flows into the prop", async () => {
    const store = createStore();
    store.set("t.c", "#ff0000");
    await render(
      {
        kind: "text",
        id: "label",
        props: { value: "hi" },
        animateBindings: { "style.color": "t.c" },
      },
      store,
    );
    expect(container.querySelector("[data-lumencast-bind-animate]")).toBeNull();
    const span = container.querySelector("span")!;
    // Canonicalised through cssColorToRgba → serializeRgba, re-validated
    // by the primitive's parseCssColor gate.
    expect(span.style.color).toBe("rgba(255, 0, 0, 1)");
  });

  it("a delta on a bound leaf does NOT remount the DOM node (RC#6 identity)", async () => {
    const store = createStore();
    store.set("g.o", 1);
    const node: RenderNode = {
      kind: "frame",
      id: "gauge",
      props: { width: 10, height: 10 },
      animateBindings: { opacity: "g.o" },
      transitions: { opacity: { kind: "none" } },
    };
    await render(node, store);
    const el = container.querySelector('[data-lumencast-bind-animate="gauge"]')!;
    (el as unknown as { __marker: number }).__marker = 42;

    await act(async () => {
      store.set("g.o", 0.2);
      // let the coalescer's rAF flush
      await new Promise((r) => setTimeout(r, 50));
    });

    const after = container.querySelector('[data-lumencast-bind-animate="gauge"]')!;
    expect(after).toBe(el);
    expect((after as unknown as { __marker: number }).__marker).toBe(42);
  });

  it("hostile colour delta on a bound colour is rejected — previous colour kept, value never logged (R9)", async () => {
    const store = createStore();
    store.set("t.c", "#22d3ee");
    await render(
      {
        kind: "text",
        id: "label",
        props: { value: "hi" },
        animateBindings: { "style.color": "t.c" },
      },
      store,
    );
    const span = container.querySelector("span")!;
    expect(span.style.color).toBe("rgba(34, 211, 238, 1)");

    const EVIL = "red; } body { background: url(http://evil)";
    await act(async () => {
      store.set("t.c", EVIL);
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(span.style.color).toBe("rgba(34, 211, 238, 1)");
    const logged = warnSpy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logged).not.toContain("evil");
  });
});
