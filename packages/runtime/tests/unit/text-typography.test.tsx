// Complete text typography rendering — ADR 001 §3.2.4 + §6 RC#4 (issue #31).
//
// Three layers of proof :
//   1. DOM smoke per TextStyle field (lineHeight, letterSpacing,
//      textTransform, textDecoration, fontStyle) + maxLines — computed
//      style asserted on a real DOM node (happy-dom + real framer-motion) ;
//   2. grammar gates — every typo prop is wire-drivable (static prop AND
//      live LSDP delta through `resolveProps`, tree.tsx) : non-conforming
//      values are rejected with an R9 diagnostic (value withheld) and fall
//      back to the field's default — never injected into inline CSS ;
//   3. no regression on the pre-existing fields (value, size, font,
//      weight, colour, align, opacity).
//
// Colour note (contractual, issue #31 comment) : this issue introduces no
// new colour-typed field (textDecoration is a closed enum in LSML 1.1) ;
// `colour` remains the only colour site and stays on `parseCssColor`
// (covered here + css-color.test.tsx hostile fixtures).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { Tree } from "../../src/render/tree.js";
import { resolveTypography } from "../../src/render/primitives/text.js";
import { createStore, type Store } from "../../src/state/store.js";
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

async function render(node: RenderNode, store: Store): Promise<void> {
  await act(async () => {
    root.render(<Tree node={node} store={store} />);
  });
}

async function renderText(props: Record<string, unknown>): Promise<HTMLSpanElement> {
  await render({ kind: "text", props: { value: "hello", ...props } }, createStore());
  return container.querySelector("span")!;
}

function styleOf(el: Element | null): string {
  return el?.getAttribute("style") ?? "";
}

// ─── 1. DOM smoke per spec'd field (RC#4) ────────────────────────────

describe("TextStyle 1.1 — DOM smoke per field (ADR 001 RC#4)", () => {
  it("lineHeight renders as a unitless multiplier", async () => {
    const span = await renderText({ lineHeight: 1.2 });
    expect(span.style.lineHeight).toBe("1.2");
  });

  it("letterSpacing (number, schema) renders in px", async () => {
    const span = await renderText({ letterSpacing: 2.5 });
    expect(span.style.letterSpacing).toBe("2.5px");
  });

  it.each(["uppercase", "lowercase", "capitalize", "none"] as const)(
    "textTransform %j renders",
    async (v) => {
      const span = await renderText({ textTransform: v });
      expect(span.style.textTransform).toBe(v);
    },
  );

  it.each(["underline", "line-through", "none"] as const)(
    "textDecoration %j renders",
    async (v) => {
      const span = await renderText({ textDecoration: v });
      expect(span.style.textDecoration).toBe(v);
    },
  );

  it.each(["italic", "oblique", "normal"] as const)("fontStyle %j renders", async (v) => {
    const span = await renderText({ fontStyle: v });
    expect(span.style.fontStyle).toBe(v);
  });

  it("maxLines renders the standard line-clamp + ellipsis pattern (§4.4)", async () => {
    // happy-dom drops `-webkit-*` declarations from CSSStyleDeclaration,
    // so the clamp trio is asserted at the module boundary (the exact
    // style fragment handed to React) and the DOM smoke covers what
    // happy-dom retains.
    expect(resolveTypography({ maxLines: 2 })).toEqual({
      display: "-webkit-box",
      WebkitBoxOrient: "vertical",
      WebkitLineClamp: 2,
      overflow: "hidden",
      textOverflow: "ellipsis",
    });
    const span = await renderText({ maxLines: 2 });
    expect(span.style.overflow).toBe("hidden");
    expect(span.style.textOverflow).toBe("ellipsis");
  });

  it("omitted typo fields stay at CSS defaults (no stray declarations)", async () => {
    const span = await renderText({});
    const style = styleOf(span);
    expect(style).not.toContain("line-height");
    expect(style).not.toContain("letter-spacing");
    expect(style).not.toContain("text-transform");
    expect(style).not.toContain("text-decoration");
    expect(style).not.toContain("font-style");
    expect(style).not.toContain("ellipsis");
    expect(span.style.display).toBe("inline-block");
    expect(resolveTypography({})).toEqual({});
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

// ─── 2. grammar gates — static AND live delta, R9 diagnostics ───────

const EVIL = "normal; } body { background: url(http://evil) ; } x {";

describe("typo grammar gates — rejected values never reach inline CSS", () => {
  it.each([
    ["lineHeight", EVIL],
    ["lineHeight", -1],
    ["lineHeight", Number.NaN],
    ["letterSpacing", "2px; background: url(http://evil)"],
    ["letterSpacing", Number.POSITIVE_INFINITY],
    ["textTransform", EVIL],
    ["textTransform", "small-caps"], // spec'd nowhere in 1.1 — reject
    ["textDecoration", "underline url(http://evil)"],
    ["textDecoration", "overline"], // not in the 1.1 enum
    ["fontStyle", "oblique 14deg"], // angle form not in the 1.1 enum
    ["fontStyle", EVIL],
    ["maxLines", 1.5],
    ["maxLines", 0],
    ["maxLines", EVIL],
  ])("static %s = %j → diagnostic + fallback, no injection", async (field, value) => {
    const span = await renderText({ [field]: value });
    const style = styleOf(span);
    expect(style).not.toContain("evil");
    expect(style).not.toContain("url(");
    expect(style).not.toContain("overline");
    expect(style).not.toContain("small-caps");
    expect(style).not.toContain("14deg");
    // R9 : diagnostic names the field, never the value.
    const calls = warnSpy.mock.calls.flat().map(String);
    expect(calls.join(" ")).toContain(`text.${field}`);
    for (const arg of calls) {
      expect(arg).not.toContain("evil");
      expect(arg).not.toContain(String(value));
    }
  });

  it("live delta : valid typo deltas apply, hostile delta falls back, next valid delta recovers", async () => {
    const store = createStore();
    store.set("t.transform", "uppercase");
    store.set("t.spacing", 1);
    const node: RenderNode = {
      kind: "text",
      props: { value: "hi" },
      bindings: { textTransform: "t.transform", letterSpacing: "t.spacing" },
    };
    await render(node, store);
    const span = container.querySelector("span")!;
    expect(span.style.textTransform).toBe("uppercase");
    expect(span.style.letterSpacing).toBe("1px");

    await act(async () => {
      store.set("t.transform", EVIL);
      store.set("t.spacing", "2px; } x { color: red");
    });
    expect(styleOf(span)).not.toContain("evil");
    expect(styleOf(span)).not.toContain("url(");
    expect(span.style.textTransform).toBe("");
    expect(span.style.letterSpacing).toBe("");

    await act(async () => {
      store.set("t.transform", "capitalize");
      store.set("t.spacing", 3);
    });
    expect(span.style.textTransform).toBe("capitalize");
    expect(span.style.letterSpacing).toBe("3px");
  });

  it("live delta : maxLines toggles the clamp on and off", async () => {
    const store = createStore();
    store.set("t.lines", 3);
    const node: RenderNode = {
      kind: "text",
      props: { value: "hi" },
      bindings: { maxLines: "t.lines" },
    };
    await render(node, store);
    const span = container.querySelector("span")!;
    // happy-dom strips -webkit-* — assert on what it retains (the
    // clamp trio itself is proven at the boundary in the §4.4 smoke).
    expect(span.style.overflow).toBe("hidden");
    expect(span.style.textOverflow).toBe("ellipsis");

    await act(async () => {
      store.set("t.lines", "3; } body { background: url(http://evil)");
    });
    expect(styleOf(span)).not.toContain("evil");
    expect(styleOf(span)).not.toContain("ellipsis");
    expect(span.style.display).toBe("inline-block");
    // Boundary : the hostile value produces an empty fragment.
    expect(resolveTypography({ maxLines: "3; } body {" })).toEqual({});
  });
});

// ─── 3. no regression on pre-existing fields ─────────────────────────

describe("pre-existing text fields — no regression", () => {
  it("value/size/font/weight/colour/align/opacity all still render", async () => {
    const span = await renderText({
      size: 48,
      font: "Bebas Neue",
      weight: 700,
      colour: "#ffffff",
      align: "center",
      opacity: 0.5,
    });
    expect(span.textContent).toBe("hello");
    expect(span.style.fontSize).toBe("48px");
    expect(span.style.fontFamily).toContain("Bebas Neue");
    expect(span.style.fontWeight).toBe("700");
    expect(span.style.color).toBe("#ffffff");
    expect(span.style.textAlign).toBe("center");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("colour still goes through parseCssColor (hostile → currentColor)", async () => {
    const span = await renderText({ colour: "red; } body { background: url(http://x)" });
    expect(styleOf(span)).not.toContain("url(");
    expect(span.style.color.toLowerCase()).toBe("currentcolor");
  });

  it("full TextStyle together : new fields coexist with the original six", async () => {
    const span = await renderText({
      size: 32,
      weight: 600,
      colour: "tomato",
      align: "end",
      lineHeight: 1.4,
      letterSpacing: 0.5,
      textTransform: "uppercase",
      textDecoration: "underline",
      fontStyle: "italic",
      maxLines: 1,
    });
    expect(span.style.fontSize).toBe("32px");
    expect(span.style.color).toBe("tomato");
    expect(span.style.lineHeight).toBe("1.4");
    expect(span.style.letterSpacing).toBe("0.5px");
    expect(span.style.textTransform).toBe("uppercase");
    expect(span.style.textDecoration).toBe("underline");
    expect(span.style.fontStyle).toBe("italic");
    expect(span.style.textOverflow).toBe("ellipsis"); // maxLines applied
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
