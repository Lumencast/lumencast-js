// Integration #K × #L — a single node carrying BOTH a shape-source `mask`
// (#K, ADR 002 A2.1) AND `fills[]` with a per-fill `blendMode` (#L, A2.2).
//
// The two features share `shape-geometry.tsx::buildShapeOutline` : #K extracted
// geometry construction there (so a mask inlines the IDENTICAL geometry as the
// on-screen render), #L threads each painted fill layer's runtime-revalidated
// `mix-blend-mode` through the paint argument. This test proves they coexist
// with ZERO interference :
//
//   1. the painted primitive layers each carry their own `mix-blend-mode` (#L) ;
//   2. the `<mask>` inlines the referenced shape's geometry as WHITE coverage
//      with NO `mix-blend-mode` — a mask is a coverage stencil, never a colour
//      or blend reproduction (#K hypothesis 2) ;
//   3. the mask is resolved INLINE (no dangling `<use href>`, no innerHTML /
//      dangerouslySetInnerHTML on the path — T3 stays green) ;
//   4. an out-of-enum per-fill blend is omitted (never passthrough) while the
//      mask + the valid sibling blend are unaffected (T4 double-gate holds in
//      the presence of a mask).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { Tree } from "../../src/render/tree.js";
import { ShapeIndexProvider, buildShapeIndex } from "../../src/render/shape-index.js";
import { createStore } from "../../src/state/store.js";
import type { RenderNode } from "../../src/render/bundle.js";

let container: HTMLDivElement;
let root: Root;
let warnSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  warnSpy.mockRestore();
  errorSpy.mockRestore();
});

/** A circle the shape-source mask references (#K). */
const REFERENCEABLE: RenderNode[] = [
  { kind: "shape", id: "mask-src", props: { geometry: "circle", width: 80, height: 80 } },
];

async function render(node: RenderNode): Promise<void> {
  const store = createStore();
  const treeRoot: RenderNode = {
    kind: "frame",
    id: "root",
    props: { width: 200, height: 200 },
    children: [node, ...REFERENCEABLE],
  };
  const index = buildShapeIndex(treeRoot);
  await act(async () => {
    root.render(
      <ShapeIndexProvider index={index}>
        <Tree node={treeRoot} store={store} />
      </ShapeIndexProvider>,
    );
  });
}

/** The inline mix-blend-mode of every PAINTED SVG layer (rect/circle/line/g)
 *  across the whole render, EXCLUDING any element inside a `<mask>` (those are
 *  coverage stencils, not painted layers — they must never carry a blend). */
function paintedBlends(): string[] {
  return [...container.querySelectorAll("rect, circle, line, g")]
    .filter((el) => el.closest("mask") === null)
    .map((el) => (el as SVGElement).style.mixBlendMode);
}

/** A node carrying BOTH a shape-source mask AND per-fill blends. */
const MASKED_AND_BLENDED: RenderNode = {
  kind: "shape",
  id: "masked-blended-1",
  props: {
    geometry: "rect",
    width: 100,
    height: 100,
    mask: { source: { kind: "shape", ref: "mask-src" }, type: "luminance", op: "intersect" },
    fills: [
      { kind: "solid", color: "#f00", blendMode: "multiply" },
      { kind: "solid", color: "#00f", blendMode: "screen" },
    ],
  },
};

describe("integration #K mask × #L per-fill blend — coexist without interference", () => {
  it("paints each fill with its own blend AND inlines the mask as a pure stencil", async () => {
    await render(MASKED_AND_BLENDED);

    // ── #L — each painted fill layer renders its own mix-blend-mode ─────
    const blends = paintedBlends();
    expect(blends).toContain("multiply");
    expect(blends).toContain("screen");

    // ── #K — the mask inlines the referenced circle geometry as WHITE ───
    const maskEl = container.querySelector("mask");
    expect(maskEl).not.toBeNull();
    // Inlined, not a dangling <use href> (T3 : geometry built element-by-element).
    expect(maskEl?.querySelector("use")).toBeNull();
    const coverage = maskEl?.querySelector("ellipse");
    expect(coverage).not.toBeNull();
    expect(coverage?.getAttribute("fill")).toBe("white");

    // ── No interference — the mask coverage carries NO blend (a stencil,
    //    not a colour/blend reproduction, #K hypothesis 2). The per-fill
    //    blend lives ONLY on the painted layers, never inside <mask>. ─────
    expect((coverage as SVGElement).style.mixBlendMode).toBe("");
    const maskBlends = [...(maskEl?.querySelectorAll("rect, ellipse, line, g") ?? [])].map(
      (el) => (el as SVGElement).style.mixBlendMode,
    );
    expect(maskBlends.every((b) => b === "")).toBe(true);

    // ── T3 — no raw-HTML escape hatch anywhere on the masked+blended path.
    expect(container.innerHTML).not.toContain("dangerouslySetInnerHTML");
  });

  it("masks the node (wrapper references the mask by url(#id))", async () => {
    await render(MASKED_AND_BLENDED);
    const id = container.querySelector("mask")?.getAttribute("id");
    expect(id).toBeTruthy();
    expect(container.querySelector(`div[style*="${id}"]`)).not.toBeNull();
  });

  it("T4 holds under a mask : an out-of-enum per-fill blend is omitted, the rest intact", async () => {
    await render({
      kind: "shape",
      id: "masked-blended-2",
      props: {
        geometry: "rect",
        width: 100,
        height: 100,
        mask: { source: { kind: "shape", ref: "mask-src" }, type: "luminance", op: "intersect" },
        fills: [
          { kind: "solid", color: "#0f0", blendMode: "overlay" },
          // out-of-enum / injection attempt — must be omitted, never passthrough.
          { kind: "solid", color: "#fff", blendMode: "url(#x);color:red" as unknown as string },
        ],
      },
    });

    const blends = paintedBlends();
    // The valid sibling blend survives.
    expect(blends).toContain("overlay");
    // The rejected value never reaches a style key (no passthrough, R9 : no value leaked).
    const styleStr = container.innerHTML.toLowerCase();
    expect(styleStr).not.toContain("url(#x");
    expect(styleStr).not.toContain("color:red");

    // The mask is unaffected by the rejected fill blend.
    const maskEl = container.querySelector("mask");
    expect(maskEl?.querySelector("ellipse")?.getAttribute("fill")).toBe("white");
  });
});
