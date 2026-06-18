// Per-fill `blendMode` render — ADR 002 A2.2 (#L).
//
// #D applies a single `mix-blend-mode` on the NODE wrapper. #L adds an
// INDEPENDENT blend per fill LAYER : a Figma node with stacked fills carries
// a blend mode per paint, each layer rendering its own `mix-blend-mode`. The
// runtime re-validates every per-fill value against the same closed enum
// (`blend-mode.ts`, the T4 runtime arm — the runtime never imports the
// compiler), so a hostile / off-enum value is omitted, never written to inline
// CSS.
//
// Proof layers :
//   1. shape with stacked fills, each its own blend → each fill SVG element
//      carries its `mix-blend-mode` ;
//   2. rétro-compat — a fill without blendMode renders no blend (normal) ;
//   3. T4 — an off-enum / hostile per-fill value is omitted, never written ;
//   4. frame backgrounds use `background-blend-mode` per layer (CSS layer
//      context, not SVG) ;
//   5. non-régression — node-level blend (#D) and per-fill blend coexist ;
//      image-fill (#F) keeps its src gating + renders its own per-fill blend.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { Tree } from "../../src/render/tree.js";
import { createStore, type Store } from "../../src/state/store.js";
import { AllowedHostsProvider } from "../../src/render/allowed-hosts.js";
import type { RenderNode } from "../../src/render/bundle.js";

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

async function render(
  node: RenderNode,
  store: Store = createStore(),
  hosts?: readonly string[],
): Promise<void> {
  await act(async () => {
    root.render(
      <AllowedHostsProvider hosts={hosts}>
        <Tree node={node} store={store} />
      </AllowedHostsProvider>,
    );
  });
}

/** mix-blend-mode of every SVG fill element (the paint layers — `<rect>` /
 *  `<circle>` / `<g>` / `<image>` parent), in render order. */
function fillBlends(): string[] {
  const svg = container.querySelector("svg")!;
  // Fill layers are the direct SVG paint elements ; strokes are filtered by
  // the absence of a blend on the fill passes. Collect the rendered shape
  // elements (rect/circle/line/g) and read their inline mix-blend-mode.
  return [...svg.children]
    .filter((el) => el.tagName.toLowerCase() !== "defs")
    .map((el) => (el as SVGElement).style.mixBlendMode);
}

// ─── 1. stacked fills, each its own blend ─────────────────────────────

describe("per-fill blend — each fill layer renders its mix-blend-mode", () => {
  it("two stacked solid fills with distinct blends → each layer its blend", async () => {
    await render({
      kind: "shape",
      id: "s",
      props: {
        geometry: "rect",
        fills: [
          { kind: "solid", color: "#f00", blendMode: "multiply" },
          { kind: "solid", color: "#00f", blendMode: "screen" },
        ],
      },
    });
    // fills[0] is rendered visually on top → reversed in SVG paint order, so
    // the SVG element order is [screen, multiply]. Assert both are present.
    const blends = fillBlends();
    expect(blends).toContain("multiply");
    expect(blends).toContain("screen");
  });

  it("gradient + solid fills each carry their own blend", async () => {
    await render({
      kind: "shape",
      id: "s",
      props: {
        geometry: "rect",
        fills: [
          {
            kind: "linear-gradient",
            stops: [
              { offset: 0, color: "#000" },
              { offset: 1, color: "#fff" },
            ],
            blendMode: "overlay",
          },
          { kind: "solid", color: "#0f0", blendMode: "darken" },
        ],
      },
    });
    const blends = fillBlends();
    expect(blends).toContain("overlay");
    expect(blends).toContain("darken");
  });
});

// ─── 2. rétro-compat — a fill without blendMode renders no blend ──────

describe("rétro-compat — a fill with no blendMode renders normal (no style)", () => {
  it("a single solid fill without blendMode → empty mix-blend-mode", async () => {
    await render({
      kind: "shape",
      id: "s",
      props: { geometry: "rect", fills: [{ kind: "solid", color: "#fff" }] },
    });
    expect(fillBlends().every((b) => b === "")).toBe(true);
  });

  it("a mixed array — only the layer with a blend carries one", async () => {
    await render({
      kind: "shape",
      id: "s",
      props: {
        geometry: "rect",
        fills: [
          { kind: "solid", color: "#f00", blendMode: "multiply" },
          { kind: "solid", color: "#00f" },
        ],
      },
    });
    const blends = fillBlends().filter((b) => b !== "");
    expect(blends).toEqual(["multiply"]);
  });
});

// ─── 3. T4 — off-enum / hostile per-fill value is omitted ─────────────

describe("T4 runtime gate — an off-enum per-fill blend is omitted, never written", () => {
  it.each([
    ["PASS_THROUGH"],
    ["MULTIPLY"],
    ["unknown-mode"],
    ["multiply; } body { background: url(http://evil)"],
    ["url(http://evil)"],
  ])("per-fill blendMode %j → no mix-blend-mode, no injection", async (mode) => {
    await render({
      kind: "shape",
      id: "s",
      props: { geometry: "rect", fills: [{ kind: "solid", color: "#fff", blendMode: mode }] },
    });
    const svg = container.querySelector("svg")!;
    const styleStr = [...svg.querySelectorAll("*")]
      .map((el) => el.getAttribute("style") ?? "")
      .join("");
    expect(styleStr.toLowerCase()).not.toContain("mix-blend-mode");
    expect(styleStr).not.toContain("evil");
    expect(styleStr).not.toContain("url(http");
  });
});

// ─── 4. frame backgrounds — background-blend-mode per layer ───────────

describe("per-fill blend on a frame background → CSS background-blend-mode", () => {
  it("two background layers with blends → comma-joined background-blend-mode", async () => {
    await render({
      kind: "frame",
      id: "f",
      props: {
        backgrounds: [
          { kind: "solid", color: "#f00", blendMode: "multiply" },
          { kind: "solid", color: "#00f", blendMode: "screen" },
        ],
      },
    });
    const div = [...container.querySelectorAll("div")].find(
      (d) => d.style.backgroundBlendMode !== "",
    );
    expect(div, "a frame layer should carry background-blend-mode").toBeDefined();
    expect(div!.style.backgroundBlendMode).toBe("multiply, screen");
  });

  it("rétro-compat — backgrounds without any blend emit no background-blend-mode", async () => {
    await render({
      kind: "frame",
      id: "f",
      props: { backgrounds: [{ kind: "solid", color: "#f00" }] },
    });
    const anyBlend = [...container.querySelectorAll("div")].some(
      (d) => d.style.backgroundBlendMode !== "",
    );
    expect(anyBlend).toBe(false);
  });

  it("an off-enum background blend falls back to normal in the joined list", async () => {
    await render({
      kind: "frame",
      id: "f",
      props: {
        backgrounds: [
          { kind: "solid", color: "#f00", blendMode: "bogus" },
          { kind: "solid", color: "#00f", blendMode: "screen" },
        ],
      },
    });
    const div = [...container.querySelectorAll("div")].find(
      (d) => d.style.backgroundBlendMode !== "",
    );
    expect(div!.style.backgroundBlendMode).toBe("normal, screen");
  });
});

// ─── 5. non-régression with node blend (#D) and image-fill (#F) ───────

describe("non-régression — node blend (#D) and image-fill (#F) coexist with per-fill blend", () => {
  it("a node-level blend wrapper coexists with per-fill blends on the SVG", async () => {
    await render({
      kind: "shape",
      id: "s",
      props: {
        geometry: "rect",
        blendMode: "hard-light",
        fills: [{ kind: "solid", color: "#fff", blendMode: "multiply" }],
      },
    });
    // node blend on a wrapper div
    const wrap = [...container.querySelectorAll("div")].find(
      (d) => d.style.mixBlendMode === "hard-light",
    );
    expect(wrap, "node-level blend wrapper").toBeDefined();
    // per-fill blend on the SVG paint element
    expect(fillBlends()).toContain("multiply");
  });

  it("an allowlisted image-fill renders its src and its per-fill blend", async () => {
    await render(
      {
        kind: "shape",
        id: "s",
        props: {
          geometry: "rect",
          fills: [{ kind: "image", src: "https://cdn.x/a.png", blendMode: "luminosity" }],
        },
      },
      createStore(),
      ["cdn.x"],
    );
    const svg = container.querySelector("svg")!;
    // the image src survives the host gate
    expect(svg.querySelector("image")!.getAttribute("href")).toBe("https://cdn.x/a.png");
    // the per-fill blend lands on the fill paint element
    expect(fillBlends()).toContain("luminosity");
  });
});
