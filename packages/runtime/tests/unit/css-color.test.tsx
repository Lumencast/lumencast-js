// Strict CSS colour parser — ADR 001 §6 RC#11 + RC#12 (issue #35).
//
// Three layers of proof :
//   1. parser unit — grammar accept/reject incl. Bastion's hostile fixtures ;
//   2. anti-ReDoS — adversarial + fuzz corpus, ≤ 1 ms per parsed value ;
//   3. render integration — hostile values neutralised when delivered as a
//      STATIC prop AND as a LIVE delta (props are wire-drivable through
//      `resolveProps`, tree.tsx) ; diagnostics never leak the value (R9).
//
// Integration tests run against the REAL framer-motion under happy-dom —
// styles land on actual DOM nodes, so we assert on the applied inline style.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { parseCssColor } from "../../src/render/css-color.js";
import { backgroundsToCss, type Fill } from "../../src/render/fill.js";
import { Tree } from "../../src/render/tree.js";
import { createStore, type Store } from "../../src/state/store.js";
import type { RenderNode } from "../../src/render/bundle.js";

// ─── 1. parser unit ──────────────────────────────────────────────────

const HOSTILE: string[] = [
  "red; }",
  "red; } body { background: blue",
  "url(http://x)",
  "url(javascript:alert(1))",
  "URL(http://x)",
  "expression(alert(1))",
  "expression(document.cookie)",
  "red}",
  ";red",
  "rgb(0,0,0); background-image: url(http://evil)",
  "color-mix(in srgb, red 50%, transparent)",
  "var(--x)",
  "calc(1px)",
  "linear-gradient(red, blue)",
  "red 0%, transparent) , url(http://x",
  "rgb(0,\n0, 0)", // inner control chars are not whitespace-canonicalised
  "javascript:alert(1)",
  "'red'",
  '"red"',
  "rgb(999, 0, 0)",
  "rgb(50%, 0, 0)", // mixed % / plain channels
  "hsl(720, 50%, 50%)",
  "hsl(10, 50, 50)", // missing %
  "#ggg",
  "#12345",
  "notacolour",
  "rgb(1,1)",
  "rgba(1,1,1,2%%)",
  "",
  " ",
];

describe("parseCssColor — strict grammar (RC#11)", () => {
  it.each([
    "#fff",
    "#fffa",
    "#0a0B0c",
    "#0a0B0cFF",
    "rgb(255, 0, 0)",
    "rgb(0,0,0)",
    "rgba(12, 34, 56, 0.5)",
    "rgba(12, 34, 56, 50%)",
    "rgb(100%, 0%, 25.5%)",
    "hsl(120, 50%, 50%)",
    "hsl(120deg, 50%, 50%)",
    "hsla(360, 100%, 100%, 0.25)",
    "red",
    "rebeccapurple",
    "transparent",
    "currentColor",
  ])("accepts %j", (input) => {
    expect(parseCssColor(input)).not.toBeNull();
  });

  it("canonicalises : trims, lowercases named/functional, preserves hex case", () => {
    expect(parseCssColor("  Red  ")).toBe("red");
    expect(parseCssColor("rgb(0, 0, 0)\n")).toBe("rgb(0, 0, 0)");
    expect(parseCssColor("RGB(1, 2, 3)")).toBe("rgb(1, 2, 3)");
    expect(parseCssColor("#AbCdEf")).toBe("#AbCdEf");
  });

  it.each(HOSTILE)("rejects hostile %j", (input) => {
    expect(parseCssColor(input)).toBeNull();
  });

  it.each([null, undefined, 42, ["red"], { color: "red" }])(
    "rejects non-string %j (never passthrough)",
    (input) => {
      expect(parseCssColor(input)).toBeNull();
    },
  );

  it("rejects values longer than 64 chars before any regex work", () => {
    expect(parseCssColor("#" + "f".repeat(64))).toBeNull();
    expect(parseCssColor("rgb(" + " ".repeat(60) + "1,1,1)")).toBeNull();
  });
});

// ─── 2. anti-ReDoS (RC#12) ───────────────────────────────────────────

/** Deterministic PRNG so the fuzz corpus is reproducible in CI. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("parseCssColor — anti-ReDoS (RC#12)", () => {
  // Near-miss payloads crafted at the grammar's ambiguity points — the
  // shapes that explode on a backtracking-vulnerable regex.
  const adversarial: string[] = [
    "rgb(" + "1".repeat(60),
    "rgb(" + "1,".repeat(30),
    "rgba(" + "1.1111,".repeat(8) + "1",
    "hsl(" + "9".repeat(60),
    "hsl(" + " ".repeat(60) + ")",
    "#" + "a".repeat(63),
    "rgb(1, 1, 1" + " ".repeat(50),
    "rgb(1.,1.,1.)",
    ("rgb(1,1,1," + ".".repeat(50)).slice(0, 64),
    "a".repeat(64),
    "rgb(((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((",
    // long inputs — must short-circuit on the length cap
    "rgb(" + "1".repeat(10_000),
    "#" + "f".repeat(100_000),
    "rgb(1,1,1," + " ".repeat(100_000) + "1)",
  ];

  it("parses every adversarial payload in ≤ 1 ms (averaged over 200 runs)", () => {
    for (const payload of adversarial) {
      const runs = 200;
      const start = performance.now();
      for (let i = 0; i < runs; i++) parseCssColor(payload);
      const perValue = (performance.now() - start) / runs;
      expect(perValue, `payload ${payload.slice(0, 24)}… took ${perValue} ms`).toBeLessThanOrEqual(
        1,
      );
    }
  });

  it("fuzz : 5 000 random inputs — no throw, no unsafe output, ≤ 1 ms each", () => {
    const rnd = mulberry32(35);
    const charset = "#rgbhsla(),.%;}{ url<>\\\"'0123456789ef-:/\n\t ";
    const runs = 5_000;
    const start = performance.now();
    for (let i = 0; i < runs; i++) {
      const len = Math.floor(rnd() * 96);
      let s = "";
      for (let j = 0; j < len; j++) s += charset[Math.floor(rnd() * charset.length)];
      const out = parseCssColor(s);
      if (out !== null) {
        // Invariant : an accepted value can never carry an injection
        // metacharacter, whatever the input shape.
        expect(out).not.toMatch(/url\(|;|\}|\{|<|>|\\|"|'|:|\/|[\n\t]/i);
      }
    }
    const perValue = (performance.now() - start) / runs;
    expect(perValue).toBeLessThanOrEqual(1);
  });
});

// ─── 3. render integration — static prop AND live delta ─────────────

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

const EVIL = "red; } body { background: url(http://evil) ; } x {";

function styleOf(el: Element | null): string {
  return el?.getAttribute("style") ?? "";
}

describe("RC#11 — hostile colours neutralised in the DOM", () => {
  it("frame.background (static prop) : hostile value never reaches inline style", async () => {
    const store = createStore();
    await render({ kind: "frame", props: { width: 100, height: 100, background: EVIL } }, store);
    const div = container.querySelector("div");
    expect(styleOf(div)).not.toContain("url(");
    expect(styleOf(div)).not.toContain("evil");
    expect(div!.style.background).toBe("");
  });

  it("frame.background (static prop) : valid value still renders", async () => {
    const store = createStore();
    await render(
      { kind: "frame", props: { width: 100, height: 100, background: "rgb(255, 0, 0)" } },
      store,
    );
    const div = container.querySelector("div");
    expect(div!.style.background).toBe("rgb(255, 0, 0)");
  });

  it("frame.background (LIVE delta via resolveProps) : hostile delta is rejected, style dropped safely", async () => {
    const store = createStore();
    store.set("scene.bg", "#00ff00");
    const node: RenderNode = {
      kind: "frame",
      props: { width: 100, height: 100 },
      bindings: { background: "scene.bg" },
    };
    await render(node, store);
    const div = container.querySelector("div")!;
    expect(div.style.background).toBe("#00ff00");

    await act(async () => {
      store.set("scene.bg", EVIL);
    });
    expect(styleOf(div)).not.toContain("url(");
    expect(styleOf(div)).not.toContain("evil");
    expect(div.style.background).toBe("");

    // A subsequent valid delta recovers.
    await act(async () => {
      store.set("scene.bg", "hsl(120, 50%, 50%)");
    });
    expect(div.style.background).toBe("hsl(120, 50%, 50%)");
  });

  it("text.colour (static prop) : hostile value falls back to currentColor", async () => {
    const store = createStore();
    await render({ kind: "text", props: { value: "hi", colour: "url(http://x)" } }, store);
    const span = container.querySelector("span")!;
    expect(styleOf(span)).not.toContain("url(");
    expect(span.style.color.toLowerCase()).toBe("currentcolor");
  });

  it("text.colour (LIVE delta) : hostile delta falls back, valid delta applies", async () => {
    const store = createStore();
    store.set("t.colour", "tomato");
    const node: RenderNode = {
      kind: "text",
      props: { value: "hi" },
      bindings: { colour: "t.colour" },
    };
    await render(node, store);
    const span = container.querySelector("span")!;
    expect(span.style.color).toBe("tomato");

    await act(async () => {
      store.set("t.colour", "expression(alert(1))");
    });
    expect(styleOf(span)).not.toContain("expression");
    expect(span.style.color.toLowerCase()).toBe("currentcolor");

    await act(async () => {
      store.set("t.colour", "#abcdef");
    });
    expect(styleOf(span)).toContain("#abcdef");
  });

  it("backgrounds[] fills (static AND live delta) : hostile solid/stop colours drop the layer", async () => {
    const store = createStore();
    const evilFills = [
      { kind: "solid", color: EVIL },
      {
        kind: "linear-gradient",
        stops: [
          { offset: 0, color: "red 0%, transparent) , url(http://x", opacity: 0.5 },
          { offset: 1, color: "blue" },
        ],
      },
      { kind: "solid", color: "#112233" },
    ];
    // Static prop — only the valid layer survives.
    await render(
      { kind: "frame", props: { width: 10, height: 10, backgrounds: evilFills } },
      store,
    );
    const div = container.querySelector("div")!;
    expect(styleOf(div)).not.toContain("url(");
    expect(styleOf(div)).not.toContain("evil");
    expect(div.style.backgroundImage).toBe("linear-gradient(#112233, #112233)");

    // Live delta on the bound prop.
    store.set("scene.bgs", [{ kind: "solid", color: "#445566" }]);
    const bound: RenderNode = {
      kind: "frame",
      props: { width: 10, height: 10 },
      bindings: { backgrounds: "scene.bgs" },
    };
    await render(bound, store);
    const div2 = container.querySelector("div")!;
    expect(div2.style.backgroundImage).toBe("linear-gradient(#445566, #445566)");
    await act(async () => {
      store.set("scene.bgs", evilFills.slice(0, 2));
    });
    expect(styleOf(div2)).not.toContain("url(");
    expect(styleOf(div2)).not.toContain("evil");
    expect(div2.style.backgroundImage).toBe("");
  });

  it("R9 — the rejection diagnostic NEVER contains the rejected value", async () => {
    const store = createStore();
    await render({ kind: "text", props: { value: "hi", colour: EVIL } }, store);
    const calls = warnSpy.mock.calls.flat().map(String);
    expect(calls.length).toBeGreaterThan(0);
    for (const arg of calls) {
      expect(arg).not.toContain("evil");
      expect(arg).not.toContain(EVIL);
    }
    // field + reason only
    expect(calls.join(" ")).toContain("text.colour");
  });
});

// cssWithOpacity (fill.tsx) — the historic color-mix injection site.
// happy-dom drops `color-mix(...)` values from CSSStyleDeclaration, so the
// composed string is asserted at the module boundary (the exact string
// handed to React's inline style).
describe("RC#11 — cssWithOpacity / backgroundsToCss (color-mix site)", () => {
  it("composes color-mix only from a strict-validated colour", () => {
    const fills: Fill[] = [
      {
        kind: "linear-gradient",
        stops: [
          { offset: 0, color: "rgb(1, 2, 3)", opacity: 0.5 },
          { offset: 1, color: "blue" },
        ],
      },
    ];
    const css = backgroundsToCss(fills);
    expect(css.backgroundImage).toContain("color-mix(in srgb, rgb(1, 2, 3) 50%, transparent)");
  });

  it("a hostile stop colour can never reach the color-mix interpolation", () => {
    const fills: Fill[] = [
      {
        kind: "linear-gradient",
        stops: [
          { offset: 0, color: "red 0%, transparent) , url(http://x", opacity: 0.5 },
          { offset: 1, color: "blue" },
        ],
      },
    ];
    expect(backgroundsToCss(fills)).toEqual({});
  });

  it("hex stop + opacity keeps the alpha-byte fast path", () => {
    const fills: Fill[] = [
      {
        kind: "linear-gradient",
        stops: [
          { offset: 0, color: "#112233", opacity: 0.5 },
          { offset: 1, color: "#445566" },
        ],
      },
    ];
    expect(backgroundsToCss(fills).backgroundImage).toContain("#11223380");
  });
});
