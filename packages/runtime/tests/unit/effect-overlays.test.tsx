// ADR 014 Tier B (Prism issue #355) — backdropBlur / noise / texture / glass
// rendered through the Tree → UniversalWrapper → EffectOverlays path.
//
// Regression coverage : `tree.tsx`'s `universal` object only read `blur`
// from `resolved`, never `backdropBlur`/`noise`/`texture`/`glass` — so the
// already-shipped backdropBlur support was a silent no-op end-to-end
// (props reached the compiled bundle, never reached the wrapper). Fixed
// alongside noise/texture/glass ; the first test below is the sentinel.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { Tree } from "../../src/render/tree.js";
import { addDiagnosticsHandler, type RenderDiagnostic } from "../../src/render/diagnostics.js";
import { createStore, type Store } from "../../src/state/store.js";
import type { RenderNode } from "../../src/render/bundle.js";

let container: HTMLDivElement;
let root: Root;
let diagnostics: RenderDiagnostic[];
let removeHandler: (() => void) | undefined;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  diagnostics = [];
});

afterEach(async () => {
  removeHandler?.();
  removeHandler = undefined;
  await act(async () => root.unmount());
  container.remove();
});

function capture(): void {
  removeHandler = addDiagnosticsHandler((d) => diagnostics.push(d));
}

async function render(node: RenderNode, store: Store = createStore()): Promise<void> {
  await act(async () => {
    root.render(<Tree node={node} store={store} />);
  });
}

describe("backdropBlur reaches the DOM — regression for the tree.tsx wiring gap", () => {
  it("shape.props.backdropBlur renders as CSS backdrop-filter on a wrapper div", async () => {
    await render({
      kind: "shape",
      id: "s",
      props: { geometry: "rect", fill: "#000", width: 10, height: 10, backdropBlur: 8 },
    });
    const wrap = [...container.querySelectorAll("div")].find((d) => d.style.backdropFilter !== "");
    expect(wrap, "a wrapper div should carry backdrop-filter").toBeDefined();
    expect(wrap!.style.backdropFilter).toBe("blur(4px)"); // 8px halved, same as `blur`
  });

  it("is universal — text also honours backdropBlur", async () => {
    await render({
      kind: "text",
      id: "t",
      props: { value: "x", backdropBlur: 20 },
    });
    const wrap = [...container.querySelectorAll("div")].find((d) => d.style.backdropFilter !== "");
    expect(wrap).toBeDefined();
  });

  it("no anti-drop diagnostic for backdropBlur", async () => {
    capture();
    await render({ kind: "shape", id: "s", props: { geometry: "rect", backdropBlur: 5 } });
    expect(diagnostics).toHaveLength(0);
  });

  it("R8 — an oversized live backdropBlur is clamped to the 100px cap, not passed through", async () => {
    await render({ kind: "shape", id: "s", props: { geometry: "rect", backdropBlur: 999999 } });
    const wrap = [...container.querySelectorAll("div")].find((d) => d.style.backdropFilter !== "");
    expect(wrap!.style.backdropFilter).toBe("blur(50px)"); // 100px cap, halved
  });
});

describe("glass.radius folds into the same backdrop-filter as backdropBlur", () => {
  it("glass alone drives backdrop-filter (radius/2)", async () => {
    await render({
      kind: "shape",
      id: "s",
      props: {
        geometry: "rect",
        glass: {
          radius: 10,
          refraction: 0,
          depth: 0,
          lightAngle: 0,
          lightIntensity: 0,
          dispersion: 0,
          splay: 0,
        },
      },
    });
    const wrap = [...container.querySelectorAll("div")].find((d) => d.style.backdropFilter !== "");
    expect(wrap!.style.backdropFilter).toBe("blur(5px)");
  });

  it("backdropBlur + glass.radius SUM, then the sum is re-clamped to the cap", async () => {
    await render({
      kind: "shape",
      id: "s",
      props: {
        geometry: "rect",
        backdropBlur: 60,
        glass: {
          radius: 60,
          refraction: 0,
          depth: 0,
          lightAngle: 0,
          lightIntensity: 0,
          dispersion: 0,
          splay: 0,
        },
      },
    });
    const wrap = [...container.querySelectorAll("div")].find((d) => d.style.backdropFilter !== "");
    // 60 + 60 = 120 → clamped to 100 → halved → 50.
    expect(wrap!.style.backdropFilter).toBe("blur(50px)");
  });
});

describe("noise / texture — SVG feTurbulence overlay renders", () => {
  it("a node with noise gets an <svg><filter> + a tinted overlay div", async () => {
    await render({
      kind: "shape",
      id: "s",
      props: {
        geometry: "rect",
        noise: { noiseSize: 4, noiseType: "MONOTONE", density: 0.5 },
      },
    });
    expect(container.querySelector("feTurbulence")).not.toBeNull();
    const filterEl = container.querySelector("filter");
    expect(filterEl).not.toBeNull();
    const overlay = [...container.querySelectorAll("div")].find((d) =>
      d.style.filter.startsWith("url(#"),
    );
    expect(overlay, "a div should carry filter: url(#<id>)").toBeDefined();
    expect(overlay!.style.opacity).toBe("0.5");
  });

  it("texture forces a fixed 0.4 density and multiply blend, ignoring the noiseType field", async () => {
    await render({
      kind: "shape",
      id: "s",
      props: { geometry: "rect", texture: { radius: 10, noiseSize: 4 } },
    });
    const overlay = [...container.querySelectorAll("div")].find((d) =>
      d.style.filter.startsWith("url(#"),
    );
    expect(overlay!.style.opacity).toBe("0.4");
    expect(overlay!.style.mixBlendMode).toBe("multiply");
  });

  it("no anti-drop diagnostic for noise/texture", async () => {
    capture();
    await render({
      kind: "shape",
      id: "s",
      props: {
        geometry: "rect",
        noise: { noiseSize: 4, noiseType: "MONOTONE", density: 0.5 },
        texture: { radius: 10, noiseSize: 4 },
      },
    });
    expect(diagnostics).toHaveLength(0);
  });
});

describe("glass — directional highlight overlay", () => {
  it("lightIntensity > 0 renders a gradient overlay div", async () => {
    await render({
      kind: "shape",
      id: "s",
      props: {
        geometry: "rect",
        glass: {
          radius: 0,
          refraction: 0,
          depth: 0,
          lightAngle: 45,
          lightIntensity: 0.6,
          dispersion: 0,
          splay: 0.3,
        },
      },
    });
    const overlay = [...container.querySelectorAll("div")].find((d) =>
      d.style.background.startsWith("linear-gradient(45deg"),
    );
    expect(overlay).toBeDefined();
  });

  it("lightIntensity <= 0 renders NO highlight overlay (matches Prism editor behaviour)", async () => {
    await render({
      kind: "shape",
      id: "s",
      props: {
        geometry: "rect",
        glass: {
          radius: 0,
          refraction: 0,
          depth: 0,
          lightAngle: 45,
          lightIntensity: 0,
          dispersion: 0,
          splay: 0,
        },
      },
    });
    const overlay = [...container.querySelectorAll("div")].find((d) =>
      d.style.background.startsWith("linear-gradient"),
    );
    expect(overlay).toBeUndefined();
  });

  it("R8 — a hostile lightAngle (NaN) normalises to 0deg instead of producing an invalid gradient", async () => {
    await render({
      kind: "shape",
      id: "s",
      props: {
        geometry: "rect",
        glass: {
          radius: 0,
          refraction: 0,
          depth: 0,
          lightAngle: Number.NaN,
          lightIntensity: 0.5,
          dispersion: 0,
          splay: 0,
        },
      },
    });
    const overlay = [...container.querySelectorAll("div")].find((d) =>
      d.style.background.startsWith("linear-gradient"),
    );
    expect(overlay!.style.background.startsWith("linear-gradient(0deg")).toBe(true);
  });
});

describe("RC#2 non-regression — a node without any Tier B prop keeps the no-op fast path", () => {
  it("no extra wrapper div for a plain shape", async () => {
    await render({ kind: "shape", id: "s", props: { geometry: "rect", fill: "#000" } });
    // The primitive itself renders a div (its own paint) — but no ADDITIONAL
    // wrapper div carrying position:relative purely for overlays.
    const relativeDivs = [...container.querySelectorAll("div")].filter(
      (d) => d.style.position === "relative",
    );
    expect(relativeDivs).toHaveLength(0);
  });
});
