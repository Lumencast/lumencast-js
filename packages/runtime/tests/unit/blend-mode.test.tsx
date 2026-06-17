// `blendMode` render — ADR 002 §3.2 (D2), issue #D.
//
// LSML 1.2 carries `blendMode` as a universal prop on every primitive ;
// the compiler validates it against the closed enum and lowers it to
// `props.blendMode` (foundation #C). This is the runtime half of #D : the
// wrapper now HONOURS that value by applying CSS `mix-blend-mode`, after
// re-validating it against the same closed enum at render (the T4 runtime
// gate of the compiler+runtime double-gate, Bastion conditions 1.2).
//
// Proof layers :
//   1. a recognised blend mode → wrapper carries `mix-blend-mode: <mode>` ;
//   2. it is universal — applies on text/shape/image/stack alike ;
//   3. `blendMode` is consumed (no anti-silent-drop diagnostic) ;
//   4. T4 — a hostile / off-enum value is OMITTED, never written to the
//      style and never passed through as a free CSS string ;
//   5. RC#2 non-regression — a node WITHOUT blendMode keeps the no-op
//      fast path (no extra wrapper, no style).

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

/** The wrapper div carrying the blend mode for a leaf (its parent). */
function wrapperOf(leaf: Element): HTMLElement {
  const wrapper = leaf.parentElement;
  expect(wrapper).not.toBeNull();
  return wrapper as HTMLElement;
}

// ─── 1. a recognised blend mode is applied ────────────────────────────

describe("blendMode render — a valid mode → CSS mix-blend-mode", () => {
  it("text blendMode:'hard-light' → wrapper mixBlendMode (the 817:84 / 817:1994 case)", async () => {
    await render({ kind: "text", id: "t", props: { value: "Ruby20", blendMode: "hard-light" } });
    const span = container.querySelector("span")!;
    expect(wrapperOf(span).style.mixBlendMode).toBe("hard-light");
  });

  it.each([
    "normal",
    "multiply",
    "screen",
    "overlay",
    "darken",
    "lighten",
    "color-dodge",
    "color-burn",
    "hard-light",
    "soft-light",
    "difference",
    "exclusion",
    "hue",
    "saturation",
    "color",
    "luminosity",
  ])("the whole closed enum renders — %s", async (mode) => {
    await render({ kind: "text", id: "t", props: { value: "x", blendMode: mode } });
    expect(wrapperOf(container.querySelector("span")!).style.mixBlendMode).toBe(mode);
  });
});

// ─── 2. universal — applies on every primitive ────────────────────────

describe("blendMode is universal — every primitive honours it", () => {
  it("shape blendMode:'multiply' (wavy shape 817:1994) → mix-blend-mode", async () => {
    await render({
      kind: "shape",
      id: "s",
      props: { geometry: "rect", fill: "#000", blendMode: "multiply" },
    });
    const wrap = [...container.querySelectorAll("div")].find(
      (d) => d.style.mixBlendMode === "multiply",
    );
    expect(wrap, "shape should have a blend-mode wrapper").toBeDefined();
  });

  it("a layout container (stack) carries the blend mode too", async () => {
    await render({
      kind: "stack",
      id: "st",
      props: { direction: "vertical", blendMode: "screen" },
      children: [{ kind: "text", id: "a", props: { value: "a" } }],
    });
    const wrap = [...container.querySelectorAll("div")].find(
      (d) => d.style.mixBlendMode === "screen",
    );
    expect(wrap, "stack should be wrapped with the blend mode").toBeDefined();
  });
});

// ─── 3. blendMode is consumed — no anti-silent-drop diagnostic ────────

describe("blendMode is in the universal allowlist", () => {
  it("no anti-drop diagnostic for a valid blendMode", async () => {
    capture();
    await render({ kind: "text", id: "t", props: { value: "x", blendMode: "overlay" } });
    expect(diagnostics.map((d) => d.field)).not.toContain("text.blendMode");
    expect(diagnostics).toHaveLength(0);
  });
});

// ─── 4. T4 — off-enum / hostile values are omitted, never passthrough ─

describe("T4 runtime gate — an off-enum blendMode is omitted, never written", () => {
  it.each([
    ["PASS_THROUGH"], // Figma's excluded mode
    ["MULTIPLY"], // upper-case (Figma token, not the CSS keyword)
    ["unknown-mode"],
    ["multiply; } body { background: url(http://evil)"], // CSS injection
    ["expression(alert(1))"],
    ["url(http://evil)"],
    [""],
  ])("blendMode %j → no mix-blend-mode, no injection", async (mode) => {
    await render({ kind: "text", id: "t", props: { value: "x", blendMode: mode } });
    const span = container.querySelector("span")!;
    const styleStr =
      (span.parentElement?.getAttribute("style") ?? "") + (span.getAttribute("style") ?? "");
    expect(styleStr.toLowerCase()).not.toContain("mix-blend-mode");
    expect(styleStr).not.toContain("evil");
    expect(styleStr).not.toContain("url(");
    expect(styleStr).not.toContain("expression(");
    // No wrapper carries the hostile value as a blend mode.
    if (span.parentElement !== container) {
      expect(span.parentElement!.style.mixBlendMode).toBe("");
    }
  });

  it.each([[42], [true], [{ mode: "multiply" }], [["multiply"]], [null]])(
    "a non-string blendMode %j is ignored",
    async (mode) => {
      await render({
        kind: "text",
        id: "t",
        props: { value: "x", blendMode: mode as unknown as string },
      });
      const span = container.querySelector("span")!;
      if (span.parentElement !== container) {
        expect(span.parentElement!.style.mixBlendMode).toBe("");
      }
    },
  );
});

// ─── 5. RC#2 non-regression — no blendMode → no-op fast path ──────────

describe("RC#2 non-regression — a node without blendMode is untouched", () => {
  it("text without blendMode → no wrapper (direct child of container)", async () => {
    await render({ kind: "text", id: "t", props: { value: "flow" } });
    const span = container.querySelector("span")!;
    expect(span.parentElement).toBe(container);
  });
});
