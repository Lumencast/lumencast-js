// Group/frame-source mask render — ADR 002 §3.2 Amendment 4 (#O).
//
// A `mask.source.kind:"group"` references a sibling GROUP/FRAME container by id ;
// the runtime composites the coverage of the container's VISIBLE direct children
// (union = native SVG alpha stacking). Proof layers (A4.4 acceptance) :
//
//   1. multi-child union : N visible children → N coverage outlines composited.
//   2. visible:false exclusion : hidden children do NOT contribute.
//   3. anti-cycle depth=1 : a container whose child carries its own mask still
//      contributes ONLY geometry — never a nested <mask>, never recursion.
//   4. budget T5 : a container above the child cap is TRUNCATED + diagnosed,
//      never an unbounded build / freeze.
//   5. pending ref / empty container → mask omitted, no crash.
//   6. non-regression : shape-source (#K) + image-source (#E) untouched.
//
// All assertions are by re-parse of the rendered DOM ; zero innerHTML.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { Tree } from "../../src/render/tree.js";
import { ShapeIndexProvider, buildShapeIndex } from "../../src/render/shape-index.js";
import { addDiagnosticsHandler, type RenderDiagnostic } from "../../src/render/diagnostics.js";
import { createStore } from "../../src/state/store.js";
import {
  buildMaskCoverageFromGroup,
  GROUP_MASK_MAX_CHILDREN,
} from "../../src/render/shape-geometry.js";
import type { RenderNode } from "../../src/render/bundle.js";

let container: HTMLDivElement;
let root: Root;
let warnSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;
let diagnostics: RenderDiagnostic[];
let removeHandler: () => void;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  diagnostics = [];
  removeHandler = addDiagnosticsHandler((d) => diagnostics.push(d));
});

afterEach(async () => {
  removeHandler();
  await act(async () => root.unmount());
  container.remove();
  warnSpy.mockRestore();
  errorSpy.mockRestore();
});

/** Render a full bundle root so the one-pass index resolves group refs exactly
 *  as in production. The masked node and the referenced container are siblings. */
async function renderRoot(children: RenderNode[]): Promise<void> {
  const store = createStore();
  const treeRoot: RenderNode = {
    kind: "frame",
    id: "root",
    props: { width: 300, height: 300 },
    children,
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

/** A masked node referencing a group container by id. */
const MASKED = (ref: string, op = "intersect", type = "luminance"): RenderNode => ({
  kind: "shape",
  id: "masked-1",
  props: {
    geometry: "rect",
    width: 100,
    height: 100,
    mask: { source: { kind: "group", ref }, type, op },
  },
});

describe("group mask — composite of visible children (union, A4.4)", () => {
  it("two visible disjoint children → both geometries composite (union)", async () => {
    await renderRoot([
      MASKED("fig-grp"),
      {
        kind: "frame",
        id: "fig-grp",
        props: { width: 100, height: 100 },
        children: [
          { kind: "shape", props: { geometry: "circle", width: 40, height: 40, x: 0, y: 0 } },
          { kind: "shape", props: { geometry: "rect", width: 30, height: 30, x: 50, y: 50 } },
        ],
      },
    ]);
    const maskEl = container.querySelector("mask");
    expect(maskEl).not.toBeNull();
    // Union = both white outlines present in the same <mask> (no <use>).
    expect(maskEl?.querySelector("circle")?.getAttribute("fill")).toBe("white");
    expect(maskEl?.querySelector("rect")?.getAttribute("fill")).toBe("white");
    expect(maskEl?.querySelector("use")).toBeNull();
    // The second child is translated by its (x,y).
    const translated = Array.from(maskEl?.querySelectorAll("g[transform]") ?? []).map((g) =>
      g.getAttribute("transform"),
    );
    expect(translated).toContain("translate(50 50)");
  });

  it("visible:false children are excluded from the composite", async () => {
    await renderRoot([
      MASKED("fig-grp"),
      {
        kind: "frame",
        id: "fig-grp",
        props: { width: 100, height: 100 },
        children: [
          // one visible ellipse + three hidden (mirrors 817:2011 : 1 of 4 visible)
          { kind: "shape", props: { geometry: "circle", width: 40, height: 40 } },
          {
            kind: "shape",
            props: { geometry: "circle", width: 40, height: 40, visible: false },
          },
          {
            kind: "shape",
            props: { geometry: "circle", width: 40, height: 40, visible: false },
          },
          {
            kind: "shape",
            props: { geometry: "circle", width: 40, height: 40, visible: false },
          },
        ],
      },
    ]);
    const maskEl = container.querySelector("mask");
    // Only the single visible ellipse contributes coverage.
    expect(maskEl?.querySelectorAll("circle").length).toBe(1);
  });

  it("a pending group ref omits the mask without crashing", async () => {
    await renderRoot([MASKED("fig-absent")]);
    expect(container.querySelector("mask")).toBeNull();
    // The masked subtree still renders unmasked.
    expect(container.querySelector('svg[viewBox="0 0 100 100"]')).not.toBeNull();
    expect(diagnostics.some((d) => d.field === "mask.source.ref")).toBe(true);
  });

  it("an empty container (no visible resolvable child) omits the mask", async () => {
    await renderRoot([
      MASKED("fig-empty"),
      { kind: "frame", id: "fig-empty", props: { width: 50, height: 50 }, children: [] },
    ]);
    expect(container.querySelector("mask")).toBeNull();
  });
});

describe("group mask — anti-cycle depth=1 (A4.4 / Bastion fixture 1)", () => {
  it("a group whose child carries its OWN mask contributes only geometry — no recursion/nested mask", async () => {
    await renderRoot([
      MASKED("fig-grp"),
      {
        kind: "frame",
        id: "fig-grp",
        props: { width: 100, height: 100 },
        children: [
          {
            // The child shape references the masked node back → a
            // mask → group → child(mask → masked-1) cycle. Must NOT recurse.
            kind: "shape",
            props: {
              geometry: "circle",
              width: 40,
              height: 40,
              mask: {
                source: { kind: "group", ref: "fig-grp" },
                type: "luminance",
                op: "intersect",
              },
            },
          },
        ],
      },
    ]);
    // The group mask exists and inlines the child geometry ONLY ; the child's
    // own mask is never read while compositing → no nested <mask> under it.
    const masks = container.querySelectorAll("mask");
    // exactly one mask per masked node ; the group composite never nests a mask.
    masks.forEach((m) => expect(m.querySelector("mask")).toBeNull());
    const groupMask = container.querySelector("mask");
    expect(groupMask?.querySelector("circle")).not.toBeNull();
    expect(groupMask?.querySelector("use")).toBeNull();
  });

  it("nested group-in-group is descended at most one container level (cap)", async () => {
    await renderRoot([
      MASKED("fig-outer"),
      {
        kind: "frame",
        id: "fig-outer",
        props: { width: 100, height: 100 },
        children: [
          // one direct shape (always covered)
          { kind: "shape", props: { geometry: "rect", width: 20, height: 20 } },
          // one sub-container (covered at depth 1)
          {
            kind: "frame",
            props: { width: 60, height: 60, x: 30, y: 30 },
            children: [
              { kind: "shape", props: { geometry: "circle", width: 20, height: 20 } },
              // a third level — must NOT be descended (depth budget = 1)
              {
                kind: "frame",
                props: { width: 10, height: 10 },
                children: [{ kind: "shape", props: { geometry: "rect", width: 5, height: 5 } }],
              },
            ],
          },
        ],
      },
    ]);
    const maskEl = container.querySelector("mask");
    expect(maskEl).not.toBeNull();
    // depth 0 rect + depth 1 circle = 2 outlines ; the depth-2 rect is dropped.
    // Total <rect> coverage elements = 1 (the depth-0 rect) — the deep rect at
    // level 2 must NOT appear.
    expect(maskEl?.querySelectorAll("circle").length).toBe(1);
    expect(maskEl?.querySelectorAll("rect").length).toBe(1);
  });
});

describe("group mask — budget T5 (A4.4 / Bastion fixture 2)", () => {
  it("a container above the child cap is truncated + diagnosed, never unbounded", async () => {
    const many: RenderNode[] = [];
    for (let i = 0; i < GROUP_MASK_MAX_CHILDREN + 8; i++) {
      many.push({ kind: "shape", props: { geometry: "rect", width: 4, height: 4, x: i, y: 0 } });
    }
    await renderRoot([
      MASKED("fig-big"),
      { kind: "frame", id: "fig-big", props: { width: 300, height: 10 }, children: many },
    ]);
    const maskEl = container.querySelector("mask");
    expect(maskEl).not.toBeNull();
    // Composite is bounded to the cap — NOT all N+8 children.
    expect(maskEl?.querySelectorAll("rect").length).toBeLessThanOrEqual(GROUP_MASK_MAX_CHILDREN);
    expect(maskEl?.querySelectorAll("rect").length).toBe(GROUP_MASK_MAX_CHILDREN);
    // Truncation is diagnosed (static reason, R9 — no id value).
    expect(
      diagnostics.some((d) => d.field === "mask.source.ref" && /cap|truncat/i.test(d.reason ?? "")),
    ).toBe(true);
  });

  it("buildMaskCoverageFromGroup is pure : returns null for an empty container, never throws", () => {
    const empty: RenderNode = { kind: "frame", id: "g", props: {}, children: [] };
    expect(buildMaskCoverageFromGroup(empty, "g")).toBeNull();
    // a non-frame node returns null (defensive).
    const notFrame: RenderNode = { kind: "shape", id: "s", props: {} };
    expect(buildMaskCoverageFromGroup(notFrame, "s")).toBeNull();
  });
});

describe("group mask — non-regression shape-source (#K)", () => {
  it("a shape-source mask still inlines the single shape outline (unchanged)", async () => {
    await renderRoot([
      {
        kind: "shape",
        id: "masked-1",
        props: {
          geometry: "rect",
          width: 100,
          height: 100,
          mask: { source: { kind: "shape", ref: "fig-s" }, type: "luminance", op: "intersect" },
        },
      },
      { kind: "shape", id: "fig-s", props: { geometry: "circle", width: 50, height: 50 } },
    ]);
    const maskEl = container.querySelector("mask");
    expect(maskEl?.querySelector("circle")?.getAttribute("fill")).toBe("white");
    expect(maskEl?.querySelector("use")).toBeNull();
  });
});
