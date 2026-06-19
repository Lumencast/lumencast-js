// Absolute placement at render — ADR 002 §3.1 (D1), issue #A.
//
// LSML 1.1 already carries `position:{x,y}` (§5.4) ; the compiler
// flattens it to `props.x`/`props.y` (and `size:{w,h}` → `width`/`height`)
// on every primitive. This is the runtime half of D1 : the renderer now
// HONOURS that placement instead of dropping it — a positioned child is
// pinned `position:absolute; left:x; top:y` relative to its nearest
// positioned ancestor, while a child WITHOUT a position keeps the normal
// flow (auto-layout untouched).
//
// Proof layers :
//   1. a positioned leaf (text/shape) renders at its `left/top` ;
//   2. `size:{w,h}` fixes the absolute box (the rating square boxes) ;
//   3. RC#2 non-regression — a child WITHOUT position is never moved ;
//      a pure auto-layout stack/grid gets no `position:relative` ;
//   4. a layout container (stack/grid) holding ≥1 absolute child flips
//      to `position:relative` so the child's coords resolve against it ;
//   5. RC#3 — a mistyped / partial position is inert (normal flow), never
//      injected and (via the allowlist) consumed without a diagnostic.
//
// Anti-drop note (ADR 001 §3.4 / ADR 002 §3.1) : `x`/`y`/`width`/`height`
// are now in the universal allowlist (`prop-allowlist.ts`), so a
// positioned node no longer trips the silent-drop diagnostic. We assert
// that explicitly below.
//
// The Rating_Block (`49:721`) non-regression FIXTURE and the live-bundle
// snapshots are issue #B (Probe) — see the `// #B hook` marker at the end
// of this file for the agreed extension point.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { Tree } from "../../src/render/tree.js";
import { addDiagnosticsHandler, type RenderDiagnostic } from "../../src/render/diagnostics.js";
import { createStore, type Store } from "../../src/state/store.js";
import type { RenderNode } from "../../src/render/bundle.js";

let container: HTMLDivElement;
let root: Root;
let warnSpy: ReturnType<typeof vi.spyOn>;
let diagnostics: RenderDiagnostic[];
let removeHandler: (() => void) | undefined;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  diagnostics = [];
});

afterEach(async () => {
  removeHandler?.();
  removeHandler = undefined;
  await act(async () => root.unmount());
  container.remove();
  warnSpy.mockRestore();
});

function capture(): void {
  removeHandler = addDiagnosticsHandler((d) => diagnostics.push(d));
}

async function render(node: RenderNode, store: Store = createStore()): Promise<void> {
  await act(async () => {
    root.render(<Tree node={node} store={store} />);
  });
}

/** The wrapper div the Tree emits for a positioned non-frame node : it is
 *  the element carrying `position: absolute` that directly wraps the leaf. */
function absoluteWrapperOf(leaf: Element): HTMLElement {
  const wrapper = leaf.parentElement;
  expect(wrapper).not.toBeNull();
  return wrapper as HTMLElement;
}

// ─── 1. positioned leaf renders at its left/top ───────────────────────

describe("absolute placement — a positioned leaf is pinned at left/top", () => {
  it("text with x/y → wrapper position:absolute; left; top", async () => {
    await render({ kind: "text", id: "t", props: { value: "RATING", x: 13, y: 8 } });
    const span = container.querySelector("span")!;
    const wrap = absoluteWrapperOf(span);
    expect(wrap.style.position).toBe("absolute");
    expect(wrap.style.left).toBe("13px");
    expect(wrap.style.top).toBe("8px");
  });

  it("two sibling texts at distinct positions do NOT stack at 0,0 (the bug)", async () => {
    // The exact failure ADR 002 D1 fixes : two absolute children of a
    // non-auto-layout frame used to collapse to the top-left.
    await render({
      kind: "frame",
      id: "rating",
      props: { width: 50, height: 50 },
      children: [
        { kind: "text", id: "label", props: { value: "RATING", x: 13, y: 8 } },
        { kind: "text", id: "score", props: { value: "8", x: 18, y: 19 } },
      ],
    });
    const [label, score] = [...container.querySelectorAll("span")];
    const lw = absoluteWrapperOf(label!);
    const sw = absoluteWrapperOf(score!);
    expect([lw.style.left, lw.style.top]).toEqual(["13px", "8px"]);
    expect([sw.style.left, sw.style.top]).toEqual(["18px", "19px"]);
    // Distinct coords — the regression was both at 0,0.
    expect(sw.style.left).not.toBe(lw.style.left);
  });

  it("shape with x/y is also placed absolutely", async () => {
    await render({
      kind: "shape",
      id: "s",
      props: { geometry: "rect", fill: "#000", x: 5, y: 7 },
    });
    const rect = container.querySelector("rect")!;
    // walk up to the wrapper carrying the absolute placement
    const wrap = [...container.querySelectorAll("div")].find(
      (d) => d.style.position === "absolute",
    );
    expect(wrap, "shape should have an absolute wrapper").toBeDefined();
    expect(wrap!.style.left).toBe("5px");
    expect(wrap!.style.top).toBe("7px");
    expect(rect).not.toBeNull();
  });
});

// ─── 2. size fixes the absolute box ───────────────────────────────────

describe("absolute box size — size:{w,h} fixes the placed box", () => {
  it("width/height alongside x/y set the wrapper box (rating text boxes)", async () => {
    await render({
      kind: "text",
      id: "t",
      props: { value: "RATING", x: 13, y: 8, width: 24, height: 7 },
    });
    const wrap = absoluteWrapperOf(container.querySelector("span")!);
    expect(wrap.style.width).toBe("24px");
    expect(wrap.style.height).toBe("7px");
  });
});

// ─── 3. RC#2 non-regression — no position → normal flow, untouched ────

describe("RC#2 non-regression — a child without position is never moved", () => {
  it("text without x/y → no wrapper / no absolute positioning", async () => {
    await render({ kind: "text", id: "t", props: { value: "flow" } });
    const span = container.querySelector("span")!;
    // No-op fast path : the span is the direct child of the container,
    // not wrapped in a positioning div.
    expect(span.parentElement).toBe(container);
  });

  it("a pure auto-layout stack gets NO position:relative", async () => {
    await render({
      kind: "stack",
      id: "st",
      props: { direction: "vertical", gap: 8 },
      children: [
        { kind: "text", id: "a", props: { value: "a" } },
        { kind: "text", id: "b", props: { value: "b" } },
      ],
    });
    const stackDiv = [...container.querySelectorAll("div")].find(
      (d) => d.style.display === "flex",
    )!;
    expect(stackDiv.style.position).toBe("");
  });

  it("a pure auto-layout grid gets NO position:relative", async () => {
    await render({
      kind: "grid",
      id: "g",
      props: { cols: "1fr 1fr" },
      children: [{ kind: "text", id: "a", props: { value: "a" } }],
    });
    const gridDiv = [...container.querySelectorAll("div")].find((d) => d.style.display === "grid")!;
    expect(gridDiv.style.position).toBe("");
  });
});

// ─── 4. container establishes the containing block when needed ────────

describe("containing block — a layout container with an absolute child flips relative", () => {
  it("stack with one absolute child → position:relative", async () => {
    await render({
      kind: "stack",
      id: "st",
      props: { direction: "vertical" },
      children: [
        { kind: "text", id: "a", props: { value: "a" } },
        { kind: "text", id: "abs", props: { value: "abs", x: 4, y: 6 } },
      ],
    });
    const stackDiv = [...container.querySelectorAll("div")].find(
      (d) => d.style.display === "flex",
    )!;
    expect(stackDiv.style.position).toBe("relative");
  });

  it("grid with one absolute child → position:relative", async () => {
    await render({
      kind: "grid",
      id: "g",
      props: { cols: "1fr" },
      children: [{ kind: "text", id: "abs", props: { value: "abs", x: 1, y: 2 } }],
    });
    const gridDiv = [...container.querySelectorAll("div")].find((d) => d.style.display === "grid")!;
    expect(gridDiv.style.position).toBe("relative");
  });

  it("frame stays its own containing block (already absolute), child resolves against it", async () => {
    await render({
      kind: "frame",
      id: "f",
      props: { width: 50, height: 50 },
      children: [{ kind: "text", id: "abs", props: { value: "x", x: 10, y: 12 } }],
    });
    // The Frame primitive owns the box (width+height) ; the wrapper carries no
    // size for a frame, so this is the (outermost) frame div. (Was keyed on a
    // frame-specific `will-change`, since removed — it isolated descendant blends.)
    const frameDiv = [...container.querySelectorAll("div")].find((d) => {
      const s = d.getAttribute("style") ?? "";
      return s.includes("width:") && s.includes("height:");
    })!;
    expect(frameDiv.style.position).toBe("absolute");
    const wrap = absoluteWrapperOf(container.querySelector("span")!);
    expect(frameDiv.contains(wrap)).toBe(true);
    expect(wrap.style.left).toBe("10px");
  });
});

// ─── 5. RC#3 — mistyped / partial position is inert, never injected ───

describe("RC#3 — a malformed position is inert (normal flow), not injected", () => {
  it.each([
    [{ x: "13", y: 8 }], // string x
    [{ x: 13 }], // missing y
    [{ y: 8 }], // missing x
    [{ x: Number.NaN, y: 8 }], // NaN
    [{ x: "13; } body { background: url(http://evil)", y: 8 }], // hostile string
  ])("position props %j → no absolute placement, no injection", async (pos) => {
    await render({ kind: "text", id: "t", props: { value: "x", ...pos } });
    const span = container.querySelector("span")!;
    const styleStr =
      (span.parentElement?.getAttribute("style") ?? "") + (span.getAttribute("style") ?? "");
    expect(styleStr).not.toContain("evil");
    expect(styleStr).not.toContain("url(");
    // Not pinned : either no wrapper, or a wrapper without absolute pos.
    if (span.parentElement !== container) {
      expect(span.parentElement!.style.position).not.toBe("absolute");
    }
  });

  it("x/y/width/height are consumed — no anti-drop diagnostic (RC#3 allowlist)", async () => {
    capture();
    await render({
      kind: "text",
      id: "t",
      props: { value: "RATING", x: 13, y: 8, width: 24, height: 7 },
    });
    const fields = diagnostics.map((d) => d.field);
    expect(fields).not.toContain("text.x");
    expect(fields).not.toContain("text.y");
    expect(fields).not.toContain("text.width");
    expect(fields).not.toContain("text.height");
    expect(diagnostics).toHaveLength(0);
  });
});

// ─── #B hook (issue #B, Probe) ────────────────────────────────────────
// Probe extends D1 validation here / in a sibling fixture file :
//   - the real Rating_Block bundle (`49:721`) compiled through
//     @lumencast/compiler, asserting the two text spans render at
//     (13,8) and (18,19), non-superposed (RC#1) ;
//   - DOM-snapshot non-regression of at least one live prod board + the
//     canary R9 bundle before/after D1 (RC#2), proving a position-less
//     child is byte-identical.
// The placement contract those fixtures rely on is the one proven above
// (wrapper position:absolute; left:x; top:y ; container relative-on-demand).
