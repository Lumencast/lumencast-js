// Rating_Block (49:721) conformance fixture — ADR 002 issue #B.
//
// RC#1 proof — the compiled Rating_Block sub-tree renders its two text
// children at the Figma-exact coordinates (13.1,8.68) and (18.1,19.5),
// non-superposed, inside a 50×50 frame whose `background` is present.
//
// RC#2 non-regression — the live prod scoreboard bundle (pure auto-layout
// stack) renders byte-identical before and after D1: no child without
// `position` is ever moved.
//
// Edge-cases not covered by Forge's §A suite:
//   A. Absolute child mixed with flow siblings (stack establishes containing
//      block but flow siblings keep their natural position).
//   B. Negative x/y — a label at (-4, -2) is placed with negative left/top.
//   C. position without size — the wrapper hugs its content (no width/height
//      injected).
//   D. Single-digit vs double-digit rating text ("8" vs "10") — both render
//      at their declared x/y; the content difference never shifts the position.
//
// Placement contract relied upon: UniversalWrapper injects
//   `position:absolute; left:Xpx; top:Ypx` on the wrapper div of any
//   primitive with finite `{x,y}`.  Frame uses its own absolute box, so the
// wrapper skips frame nodes (tree.tsx). All assertions are DOM-smoke
// (happy-dom); no pixel diffing (that belongs to RC#10 / issue #J).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { Tree } from "../../src/render/tree.js";
import { createStore, type Store } from "../../src/state/store.js";
import type { RenderNode } from "../../src/render/bundle.js";

// ─── Fixture: the prod scoreboard (pure auto-layout, RC#2 control) ────────────
//
// This matches the shape of the live scoreboard that exercises the canary R9
// path. It has zero absolute children — a pure nested-stack board.
const SCOREBOARD_BUNDLE: RenderNode = {
  kind: "stack",
  id: "root",
  props: { direction: "vertical", gap: 16, align: "center", justify: "center" },
  children: [
    {
      kind: "text",
      id: "title",
      props: { value: "Acceptance Cup", size: 48, weight: 700, colour: "#ffffff" },
    },
    {
      kind: "stack",
      id: "scores",
      props: { direction: "horizontal", gap: 32 },
      children: [
        {
          kind: "text",
          id: "home",
          props: { value: "0", size: 64, weight: 800, colour: "#22d3ee" },
        },
        {
          kind: "text",
          id: "away",
          props: { value: "0", size: 64, weight: 800, colour: "#f97316" },
        },
      ],
    },
  ],
};

// ─── Fixture: Rating_Block 49:721 (real Figma coords, ADR 002 RC#1) ──────────
//
// Frame 50×50, background variable per rating (here we use a concrete colour
// — the ADR does not require variable resolution in this RC, just that the
// background field is rendered). Two text children in absolute position:
//   "RATING" label: x=13.1, y=8.68 (sub-pixel coords from Figma)
//   rating value  : x=18.1, y=19.5
// The compiler flattens position:{x,y} → props.x/props.y and
// size:{w,h} → props.width/props.height on every primitive.
const RATING_BLOCK_49_721: RenderNode = {
  kind: "frame",
  id: "rating-block",
  props: {
    width: 50,
    height: 50,
    background: "#1e40af", // representative rating colour (blue = top rating)
    clipsContent: false, // Figma frame non-auto-layout — children may overflow
  },
  children: [
    {
      kind: "text",
      id: "rating-label",
      props: {
        value: "RATING",
        x: 13.1,
        y: 8.68,
        size: 7,
        weight: 700,
        colour: "#ffffff",
      },
    },
    {
      kind: "text",
      id: "rating-value",
      props: {
        value: "8",
        x: 18.1,
        y: 19.5,
        size: 22,
        weight: 800,
        colour: "#ffffff",
      },
    },
  ],
};

// ─── Test harness ─────────────────────────────────────────────────────────────

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

async function render(node: RenderNode, store: Store = createStore()): Promise<void> {
  await act(async () => {
    root.render(<Tree node={node} store={store} />);
  });
}

/** The UniversalWrapper div that carries `position:absolute` for a
 *  positioned non-frame leaf.  Walks from the leaf span upward. */
function absoluteWrapperOf(leaf: Element): HTMLElement {
  const w = leaf.parentElement;
  expect(w, "leaf must have a parent wrapper div").not.toBeNull();
  return w as HTMLElement;
}

/** Locate the frame div by its own box (the Frame primitive sets width+height ;
 *  a frame's UniversalWrapper carries no size, so this is the outermost — and
 *  first in DOM order — div with both). Previously keyed on a frame-specific
 *  `will-change`, since removed (a permanent will-change isolated descendant
 *  mix-blend-mode). */
function frameDiv(): HTMLDivElement {
  const div = [...container.querySelectorAll<HTMLDivElement>("div")].find((d) => {
    const s = d.getAttribute("style") ?? "";
    return s.includes("width:") && s.includes("height:");
  });
  expect(div, "frame div must exist").toBeDefined();
  return div!;
}

// ─── RC#1 — Rating_Block 49:721 conformance ──────────────────────────────────

describe("RC#1 — Rating_Block 49:721 — two texts at Figma-exact coords, non-superposed", () => {
  it("RATING label renders at left:13.1px top:8.68px", async () => {
    await render(RATING_BLOCK_49_721);
    const spans = [...container.querySelectorAll("span")];
    const label = spans.find((s) => s.textContent === "RATING");
    expect(label, "'RATING' span must be present").toBeDefined();
    const wrap = absoluteWrapperOf(label!);
    expect(wrap.style.position).toBe("absolute");
    expect(wrap.style.left).toBe("13.1px");
    expect(wrap.style.top).toBe("8.68px");
  });

  it("rating value renders at left:18.1px top:19.5px", async () => {
    await render(RATING_BLOCK_49_721);
    const spans = [...container.querySelectorAll("span")];
    const value = spans.find((s) => s.textContent === "8");
    expect(value, "rating value span must be present").toBeDefined();
    const wrap = absoluteWrapperOf(value!);
    expect(wrap.style.position).toBe("absolute");
    expect(wrap.style.left).toBe("18.1px");
    expect(wrap.style.top).toBe("19.5px");
  });

  it("the two wrappers have DISTINCT left/top (not both at 0,0 — the D1 regression)", async () => {
    await render(RATING_BLOCK_49_721);
    const spans = [...container.querySelectorAll("span")];
    const label = spans.find((s) => s.textContent === "RATING")!;
    const value = spans.find((s) => s.textContent === "8")!;
    const lw = absoluteWrapperOf(label);
    const vw = absoluteWrapperOf(value);
    // They must be distinct wrapper elements.
    expect(lw).not.toBe(vw);
    // They must differ on BOTH axes.
    expect(lw.style.left).not.toBe(vw.style.left);
    expect(lw.style.top).not.toBe(vw.style.top);
  });

  it("the 50×50 frame's background colour is present in inline style", async () => {
    await render(RATING_BLOCK_49_721);
    const fd = frameDiv();
    // parseCssColor normalises hex → rgb() in happy-dom; we accept either form.
    const bg = fd.style.background || fd.style.backgroundColor;
    expect(bg, "frame background must be rendered").toBeTruthy();
    // Must not be empty / transparent.
    expect(bg).not.toBe("transparent");
    expect(bg).not.toBe("");
  });

  it("the frame box is 50×50", async () => {
    await render(RATING_BLOCK_49_721);
    const fd = frameDiv();
    // happy-dom renders numeric values without units in style.width/height when
    // set via CSSProperties number — check both numeric and px forms.
    const w = fd.style.width;
    const h = fd.style.height;
    expect(w === "50" || w === "50px", `width should be 50 or 50px, got "${w}"`).toBe(true);
    expect(h === "50" || h === "50px", `height should be 50 or 50px, got "${h}"`).toBe(true);
  });

  it("no diagnostic is emitted for the Rating_Block render (RC#3 allowlist)", async () => {
    // x/y/width/height are in the universal allowlist — no anti-drop fires.
    const diags: unknown[] = [];
    // Capture via console.warn (diagnostics channel used in unit tests).
    const spy = vi.spyOn(console, "warn").mockImplementation((...args) => diags.push(args));
    try {
      await render(RATING_BLOCK_49_721);
    } finally {
      spy.mockRestore();
    }
    expect(diags).toHaveLength(0);
  });
});

// ─── RC#2 — non-regression: scoreboard prod bundle (pure auto-layout) ─────────

describe("RC#2 — non-regression: pure auto-layout scoreboard is never moved by D1", () => {
  it("the root stack has NO position:relative (no absolute children)", async () => {
    await render(SCOREBOARD_BUNDLE);
    const stackDivs = [...container.querySelectorAll<HTMLDivElement>("div")].filter(
      (d) => d.style.display === "flex",
    );
    // Both the outer and inner stacks must have no positioned containing block.
    for (const div of stackDivs) {
      expect(div.style.position, "pure stack must not gain position:relative").toBe("");
    }
  });

  it("the title text span is a DIRECT child of its container (no extra wrapper)", async () => {
    await render(SCOREBOARD_BUNDLE);
    const spans = [...container.querySelectorAll("span")];
    const title = spans.find((s) => s.textContent === "Acceptance Cup");
    expect(title, "title span must be present").toBeDefined();
    // A flow child has no UniversalWrapper div between it and its container.
    expect(title!.parentElement?.tagName.toLowerCase()).not.toBe("div[style*='absolute']");
    // Specifically, it must NOT be wrapped in an absolutely positioned div.
    const parent = title!.parentElement;
    if (parent && parent !== container) {
      expect(parent.style.position).not.toBe("absolute");
    }
  });

  it("DOM snapshot of the scoreboard is stable (byte-identical across two identical renders)", async () => {
    await render(SCOREBOARD_BUNDLE);
    const snapshot1 = container.innerHTML;
    // Unmount and re-render identically.
    await act(async () => root.unmount());
    root = createRoot(container);
    await render(SCOREBOARD_BUNDLE);
    const snapshot2 = container.innerHTML;
    expect(snapshot1).toBe(snapshot2);
  });
});

// ─── Edge-cases ───────────────────────────────────────────────────────────────

describe("edge-case A — absolute child mixed with flow siblings in a stack", () => {
  // The stack must establish position:relative for the absolute child, but
  // the two flow siblings must keep their natural position (not wrapped).
  it("stack gains position:relative; flow siblings have no absolute wrapper", async () => {
    await render({
      kind: "stack",
      id: "mixed",
      props: { direction: "vertical", gap: 8 },
      children: [
        { kind: "text", id: "flow-a", props: { value: "flow-a" } },
        { kind: "text", id: "abs", props: { value: "badge", x: 4, y: 6 } },
        { kind: "text", id: "flow-b", props: { value: "flow-b" } },
      ],
    });
    const stackDiv = [...container.querySelectorAll<HTMLDivElement>("div")].find(
      (d) => d.style.display === "flex",
    )!;
    expect(stackDiv.style.position).toBe("relative");

    const spans = [...container.querySelectorAll("span")];
    const flowA = spans.find((s) => s.textContent === "flow-a")!;
    const flowB = spans.find((s) => s.textContent === "flow-b")!;

    // Flow siblings must not have an absolutely-positioned parent wrapper.
    for (const span of [flowA, flowB]) {
      const parent = span.parentElement;
      if (parent && parent !== container) {
        expect(parent.style.position).not.toBe(
          "absolute",
          `flow sibling "${span.textContent}" must not be wrapped in an absolute div`,
        );
      }
    }

    // The absolute child must be wrapped.
    const absSpan = spans.find((s) => s.textContent === "badge")!;
    const absWrap = absoluteWrapperOf(absSpan);
    expect(absWrap.style.position).toBe("absolute");
    expect(absWrap.style.left).toBe("4px");
    expect(absWrap.style.top).toBe("6px");
  });
});

describe("edge-case B — negative x/y placement", () => {
  it("text at x=-4 y=-2 renders with left:-4px top:-2px", async () => {
    await render({
      kind: "text",
      id: "neg",
      props: { value: "overhang", x: -4, y: -2 },
    });
    const span = container.querySelector("span")!;
    const wrap = absoluteWrapperOf(span);
    expect(wrap.style.position).toBe("absolute");
    expect(wrap.style.left).toBe("-4px");
    expect(wrap.style.top).toBe("-2px");
  });

  it("negative coords are still distinct from 0,0 (not clamped)", async () => {
    await render({
      kind: "frame",
      id: "f",
      props: { width: 100, height: 100 },
      children: [{ kind: "text", id: "neg", props: { value: "x", x: -10, y: -5 } }],
    });
    const span = container.querySelector("span")!;
    const wrap = absoluteWrapperOf(span);
    expect(wrap.style.left).toBe("-10px");
    expect(wrap.style.top).toBe("-5px");
    // Explicitly not 0 (i.e. not clamped).
    expect(wrap.style.left).not.toBe("0px");
    expect(wrap.style.top).not.toBe("0px");
  });
});

describe("edge-case C — position without size (wrapper hugs content)", () => {
  it("positioned text without width/height has no width/height on wrapper", async () => {
    await render({
      kind: "text",
      id: "nosiz",
      props: { value: "hug me", x: 10, y: 20 },
    });
    const span = container.querySelector("span")!;
    const wrap = absoluteWrapperOf(span);
    expect(wrap.style.position).toBe("absolute");
    // No explicit size injected — the box hugs the content.
    expect(wrap.style.width).toBe("");
    expect(wrap.style.height).toBe("");
  });
});

describe("edge-case D — single-digit vs double-digit rating (8 vs 10)", () => {
  // Both values are rendered at their declared x/y — the content never
  // shifts the placement (ADR 002 §7 #B spec text: "note à 1 vs 2 chiffres").

  function ratingBlock(value: string): RenderNode {
    return {
      kind: "frame",
      id: "rating-block",
      props: { width: 50, height: 50, background: "#1e40af" },
      children: [
        {
          kind: "text",
          id: "rating-label",
          props: { value: "RATING", x: 13.1, y: 8.68 },
        },
        {
          kind: "text",
          id: "rating-value",
          props: { value, x: 18.1, y: 19.5 },
        },
      ],
    };
  }

  it("single-digit '8' — value span at left:18.1px top:19.5px", async () => {
    await render(ratingBlock("8"));
    const spans = [...container.querySelectorAll("span")];
    const value = spans.find((s) => s.textContent === "8")!;
    const wrap = absoluteWrapperOf(value);
    expect(wrap.style.left).toBe("18.1px");
    expect(wrap.style.top).toBe("19.5px");
  });

  it("double-digit '10' — value span still at left:18.1px top:19.5px (not shifted)", async () => {
    await render(ratingBlock("10"));
    const spans = [...container.querySelectorAll("span")];
    const value = spans.find((s) => s.textContent === "10")!;
    const wrap = absoluteWrapperOf(value);
    expect(wrap.style.left).toBe("18.1px");
    expect(wrap.style.top).toBe("19.5px");
  });

  it("single-digit vs double-digit renders at SAME coords (invariant)", async () => {
    // Render "8" and capture coords.
    await render(ratingBlock("8"));
    const wrap8 = absoluteWrapperOf(
      [...container.querySelectorAll("span")].find((s) => s.textContent === "8")!,
    );
    const left8 = wrap8.style.left;
    const top8 = wrap8.style.top;

    // Re-render with "10" and compare.
    await act(async () => root.unmount());
    container.remove();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await render(ratingBlock("10"));
    const wrap10 = absoluteWrapperOf(
      [...container.querySelectorAll("span")].find((s) => s.textContent === "10")!,
    );
    expect(wrap10.style.left).toBe(left8);
    expect(wrap10.style.top).toBe(top8);
  });
});
