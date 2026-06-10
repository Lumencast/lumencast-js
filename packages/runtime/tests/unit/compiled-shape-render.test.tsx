// Issue #29 / ADR 001 §6 RC#2 — end-to-end compiler→render proof.
//
// The compiler is imported by SOURCE path (its `@lumencast/runtime`
// imports are type-only and erase at runtime) so this test exercises the
// real chain : an LSML 1.1 bundle goes through `compileBundle`, the
// resulting RenderNode is rendered by the real Tree under happy-dom, and
// the 1.1 design fields are asserted in the DOM :
//   - `cornerRadius` → non-zero `rx` on the SVG rect (the RC#2 wording) ;
//   - `geometry` is honoured (circle renders a <circle>) ;
//   - `fills[]` → SVG gradient defs ; single `stroke` → stroke attrs.
//
// Runs against the REAL framer-motion (no mock) like css-color.test.tsx.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { Tree } from "../../src/render/tree.js";
import { createStore } from "../../src/state/store.js";
import type { RenderNode } from "../../src/render/bundle.js";
import { compileBundle, ZERO_HASH, type LSMLNode } from "../../../compiler/src/index.js";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function renderCompiled(layout: LSMLNode): Promise<RenderNode> {
  const bundle = compileBundle({
    lsml: "1.1",
    scene_id: "e2e",
    scene_version: ZERO_HASH,
    layout,
  });
  const node = bundle.root as RenderNode;
  const store = createStore();
  await act(async () => {
    root.render(<Tree node={node} store={store} />);
  });
  return node;
}

describe("compiler→render e2e (RC#2)", () => {
  it("an LSML cornerRadius produces a non-zero rx in the DOM", async () => {
    await renderCompiled({
      kind: "shape",
      geometry: "rect",
      size: { w: 200, h: 50 },
      fill: "#ff0000",
      cornerRadius: 8,
    });
    const rect = container.querySelector("rect");
    expect(rect).not.toBeNull();
    expect(rect?.getAttribute("rx")).toBe("8");
  });

  it("geometry: circle renders a <circle> (geometry prop honoured)", async () => {
    await renderCompiled({
      kind: "shape",
      geometry: "circle",
      size: { w: 40, h: 40 },
      fill: "#00ff00",
    });
    expect(container.querySelector("circle")).not.toBeNull();
    expect(container.querySelector("rect")).toBeNull();
  });

  it("fills[] produce SVG gradient defs ; single stroke lands as stroke attrs", async () => {
    await renderCompiled({
      kind: "shape",
      geometry: "rect",
      size: { w: 100, h: 20 },
      fills: [
        {
          kind: "linear-gradient",
          angle_deg: 90,
          stops: [
            { offset: 0, color: "#ff7e00" },
            { offset: 1, color: "#ff1a3d" },
          ],
        },
      ],
      stroke: { color: "#ffffff", width: 2 },
    });
    expect(container.querySelector("linearGradient")).not.toBeNull();
    const stroked = Array.from(container.querySelectorAll("rect")).find(
      (r) => r.getAttribute("stroke") === "#ffffff",
    );
    expect(stroked).not.toBeNull();
    expect(stroked?.getAttribute("stroke-width")).toBe("2");
  });

  it("keyframes + repeat stagger land on the RenderNode the runtime consumes", async () => {
    const node = await renderCompiled({
      kind: "repeat",
      scope: "p",
      bind: { items: "players" },
      stagger_ms: 80,
      template: {
        kind: "frame",
        size: { w: 10, h: 10 },
        keyframes: {
          steps: [
            { at: 0, opacity: 0, transform: { translate: [10, 0] } },
            { at: 1, opacity: 1, transform: { translate: [0, 0] } },
          ],
          duration_ms: 200,
          easing: "ease-out",
        },
      },
    });
    expect(node.stagger_ms).toBe(80);
    const template = node.children?.[0];
    expect(template?.keyframes?.steps[0]).toEqual({
      at: 0,
      opacity: 0,
      transform: { translateX: 10, translateY: 0 },
    });
  });
});
